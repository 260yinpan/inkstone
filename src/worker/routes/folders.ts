import { Hono } from 'hono'
import { LIMITS } from '@shared/constants'
import { truncateText } from '@shared/text-utils'
import type { Folder } from '@shared/types'
import type { AppBindings } from '../env'
import { toFolder, type FolderRow } from '../db/rows'
import { ApiError } from '../lib/errors'
import { newId } from '../lib/id'
import { broadcastCursor } from '../lib/notify'
import { JSON_BODY_LIMITS, readJson } from '../lib/request'
import { requireAuth } from '../middleware/auth'

export const foldersRoutes = new Hono<AppBindings>()

foldersRoutes.use('*', requireAuth)

const FOLDER_SELECT = `f.id, f.parent_id, f.name, f.icon, f.position, f.created_at, f.updated_at,
  (SELECT COUNT(*) FROM notes n
     WHERE n.folder_id = f.id AND n.user_id = f.user_id
       AND n.deleted_at IS NULL AND n.is_archived = 0) AS note_count`

foldersRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${FOLDER_SELECT} FROM folders f
      WHERE f.user_id = ?1 AND f.deleted_at IS NULL
      ORDER BY f.position ASC, f.created_at ASC`,
  )
    .bind(c.get('userId'))
    .all<FolderRow>()
  return c.json({ folders: results.map(toFolder) })
})

foldersRoutes.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await readJson<{ name?: string; parentId?: string | null; icon?: string | null }>(c, JSON_BODY_LIMITS.small)

  if (body.name !== undefined && typeof body.name !== 'string') {
    throw ApiError.badRequest('name must be a string')
  }
  if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== 'string') {
    throw ApiError.badRequest('parentId must be a string or null')
  }
  if (body.icon !== undefined && body.icon !== null && typeof body.icon !== 'string') {
    throw ApiError.badRequest('icon must be a string or null')
  }
  const name = (body.name ?? '').trim() || "New folder"
  if (name.length > LIMITS.folderNameMaxLength) throw ApiError.badRequest('Folder name is too long')

  const graph = await loadFolderGraph(c.env.DB, userId)
  const parentId = validateParent(graph, body.parentId ?? null)
  if (parentId && folderDepth(graph, parentId) >= LIMITS.folderDepthMax) {
    throw ApiError.badRequest(`Folder depth cannot exceed ${LIMITS.folderDepthMax} levels`)
  }

  const id = newId()
  const now = Date.now()
  const insert = c.env.DB.prepare(
    `WITH RECURSIVE ancestors(id, parent_id, depth) AS (
       SELECT id, parent_id, 1 FROM folders
        WHERE id = ?3 AND user_id = ?2 AND deleted_at IS NULL
       UNION ALL
       SELECT f.id, f.parent_id, a.depth + 1
         FROM folders f JOIN ancestors a ON f.id = a.parent_id
        WHERE f.user_id = ?2 AND f.deleted_at IS NULL AND a.depth < ?8
     )
     INSERT OR IGNORE INTO folders (id, user_id, parent_id, name, icon, position, created_at, updated_at)
     SELECT ?1, ?2, ?3, ?4, ?5,
            COALESCE((SELECT MAX(position) FROM folders
                       WHERE user_id = ?2 AND parent_id IS ?3 AND deleted_at IS NULL), 0) + 1000,
            ?6, ?6
      WHERE (?3 IS NULL OR EXISTS (
               SELECT 1 FROM folders WHERE id = ?3 AND user_id = ?2 AND deleted_at IS NULL
             ))
        AND COALESCE((SELECT MAX(depth) FROM ancestors), 0) < ?7`,
  ).bind(
    id,
    userId,
    parentId,
    name,
    body.icon ? truncateText(body.icon, 8) || null : null,
    now,
    LIMITS.folderDepthMax,
    LIMITS.folderDepthMax + 1,
  )
  const change = c.env.DB.prepare(
    `INSERT INTO changes (user_id, entity, entity_id, op, at)
     SELECT ?1, 'folder', ?2, 'upsert', ?3
      WHERE EXISTS (SELECT 1 FROM folders WHERE id = ?2 AND user_id = ?1)`,
  ).bind(userId, id, now)
  const [created] = await c.env.DB.batch([insert, change])
  if (!created?.meta.changes) throw ApiError.conflict('The parent folder changed or a sibling already uses this name')
  await broadcastCursor(c)
  return c.json(await loadFolder(c.env.DB, userId, id), 201)
})

foldersRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = await readJson<{
    name?: string
    parentId?: string | null
    icon?: string | null
  }>(c, JSON_BODY_LIMITS.small)

  const existing = await c.env.DB.prepare(
    `SELECT id, parent_id, updated_at FROM folders WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(id, userId)
    .first<{ id: string; parent_id: string | null; updated_at: number }>()
  if (!existing) throw ApiError.notFound('Folder not found')

  const sets: string[] = []
  const binds: unknown[] = []

  if (body.name !== undefined && typeof body.name !== 'string') {
    throw ApiError.badRequest('name must be a string')
  }
  if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== 'string') {
    throw ApiError.badRequest('parentId must be a string or null')
  }
  if (body.icon !== undefined && body.icon !== null && typeof body.icon !== 'string') {
    throw ApiError.badRequest('icon must be a string or null')
  }
  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) throw ApiError.badRequest('Folder name cannot be empty')
    if (name.length > LIMITS.folderNameMaxLength) throw ApiError.badRequest('Folder name is too long')
    binds.push(name)
    sets.push(`name = ?${binds.length}`)
  }
  if (body.icon !== undefined) {
    binds.push(body.icon ? truncateText(body.icon, 8) : null)
    sets.push(`icon = ?${binds.length}`)
  }
  const graph = await loadFolderGraph(c.env.DB, userId)
  let parentId = existing.parent_id
  if (body.parentId !== undefined) {
    parentId = validateParent(graph, body.parentId, id)
    const nextDepth = (parentId ? folderDepth(graph, parentId) : 0) + subtreeHeight(graph, id)
    if (nextDepth > LIMITS.folderDepthMax) {
      throw ApiError.badRequest(`Folder depth cannot exceed ${LIMITS.folderDepthMax} levels`)
    }
    binds.push(parentId)
    sets.push(`parent_id = ?${binds.length}`)
  }
  if (!sets.length) return c.json(await loadFolder(c.env.DB, userId, id))

  const updatedAt = Math.max(Date.now(), existing.updated_at + 1)
  binds.push(updatedAt)
  sets.push(`updated_at = ?${binds.length}`)
  const shiftedSets = sets.map((set) => set.replace(/\?(\d+)/g, (_m, n: string) => `?${Number(n) + 3}`))
  const update = c.env.DB.prepare(
    `WITH RECURSIVE
       descendants(id, depth) AS (
         SELECT id, 1 FROM folders WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL
         UNION ALL
         SELECT f.id, d.depth + 1 FROM folders f JOIN descendants d ON f.parent_id = d.id
          WHERE f.user_id = ?2 AND f.deleted_at IS NULL AND d.depth < ?${binds.length + 5}
       ),
       ancestors(id, parent_id, depth) AS (
         SELECT id, parent_id, 1 FROM folders WHERE id = ?3 AND user_id = ?2 AND deleted_at IS NULL
         UNION ALL
         SELECT f.id, f.parent_id, a.depth + 1 FROM folders f JOIN ancestors a ON f.id = a.parent_id
          WHERE f.user_id = ?2 AND f.deleted_at IS NULL AND a.depth < ?${binds.length + 5}
       )
     UPDATE OR IGNORE folders SET ${shiftedSets.join(', ')}
      WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL
        AND updated_at = ?${binds.length + 4}
        AND (?3 IS NULL OR EXISTS (
          SELECT 1 FROM folders WHERE id = ?3 AND user_id = ?2 AND deleted_at IS NULL
        ))
        AND NOT EXISTS (SELECT 1 FROM descendants WHERE id = ?3)
        AND COALESCE((SELECT MAX(depth) FROM ancestors), 0)
            + COALESCE((SELECT MAX(depth) FROM descendants), 1) <= ?${binds.length + 5}`,
  ).bind(id, userId, parentId, ...binds, existing.updated_at, LIMITS.folderDepthMax)
  const change = c.env.DB.prepare(
    `INSERT INTO changes (user_id, entity, entity_id, op, at)
     SELECT ?1, 'folder', ?2, 'upsert', ?3
      WHERE EXISTS (SELECT 1 FROM folders WHERE id = ?2 AND user_id = ?1 AND updated_at = ?3)`,
  ).bind(userId, id, updatedAt)
  const [updated] = await c.env.DB.batch([update, change])
  if (!updated?.meta.changes) throw ApiError.conflict('The folder changed elsewhere or a sibling already uses this name')
  await broadcastCursor(c)
  return c.json(await loadFolder(c.env.DB, userId, id))
})

foldersRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const strategy = parseFolderDeleteStrategy(c.req.query('strategy'))
  const { ftsEnabled } = c.get('database')
  const now = Date.now()

  const row = await c.env.DB.prepare(
    `SELECT id, parent_id, updated_at FROM folders WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(id, userId)
    .first<{ id: string; parent_id: string | null; updated_at: number }>()
  if (!row) throw ApiError.notFound('Folder not found')

  if (strategy === 'move-up') {
    const guard = `EXISTS (SELECT 1 FROM folders
      WHERE id = ?1 AND user_id = ?2 AND updated_at = ?3 AND deleted_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM folders child
        JOIN folders sibling
          ON sibling.user_id = child.user_id
         AND sibling.parent_id IS (
           SELECT parent_id FROM folders WHERE id = ?1 AND user_id = ?2
         )
         AND lower(sibling.name) = lower(child.name)
         AND sibling.deleted_at IS NULL
         AND sibling.id != child.id
       WHERE child.parent_id = ?1 AND child.user_id = ?2 AND child.deleted_at IS NULL
      )`
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO changes (user_id, entity, entity_id, op, at)
         SELECT ?2, 'folder', id, 'upsert', ?4 FROM folders
          WHERE parent_id = ?1 AND user_id = ?2 AND deleted_at IS NULL AND ${guard}`,
      ).bind(id, userId, row.updated_at, now),
      c.env.DB.prepare(
        `INSERT INTO changes (user_id, entity, entity_id, op, at)
         SELECT ?2, 'note', id, 'upsert', ?4 FROM notes
          WHERE folder_id = ?1 AND user_id = ?2 AND ${guard}`,
      ).bind(id, userId, row.updated_at, now),
      c.env.DB.prepare(
        `INSERT INTO changes (user_id, entity, entity_id, op, at)
         SELECT ?2, 'folder', ?1, 'delete', ?4 WHERE ${guard}`,
      ).bind(id, userId, row.updated_at, now),
      c.env.DB.prepare(
        `UPDATE folders SET parent_id = ?4, updated_at = MAX(updated_at + 1, ?5)
          WHERE parent_id = ?1 AND user_id = ?2 AND deleted_at IS NULL AND ${guard}`,
      ).bind(id, userId, row.updated_at, row.parent_id, now),
      c.env.DB.prepare(
        `UPDATE notes SET folder_id = ?4, updated_at = MAX(updated_at + 1, ?5), rev = rev + 1
          WHERE folder_id = ?1 AND user_id = ?2 AND ${guard}`,
      ).bind(id, userId, row.updated_at, row.parent_id, now),
      c.env.DB.prepare(
        `DELETE FROM folders WHERE id = ?1 AND user_id = ?2 AND updated_at = ?3
          AND deleted_at IS NULL AND ${guard}`,
      ).bind(id, userId, row.updated_at),
    ]
    const results = await c.env.DB.batch(statements)
    if (!results.at(-1)?.meta.changes) throw ApiError.conflict('The folder changed elsewhere. Refresh and try again')
  } else {
    const tree = subtreeCteWithRevision()
    const noteIds = `SELECT n.id FROM notes n WHERE n.user_id = ?2 AND n.folder_id IN (SELECT id FROM subtree)`
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `${tree} INSERT INTO changes (user_id, entity, entity_id, op, at)
         SELECT ?2, 'folder', id, 'delete', ?4 FROM subtree`,
      ).bind(id, userId, row.updated_at, now),
      c.env.DB.prepare(
        `${tree} INSERT INTO changes (user_id, entity, entity_id, op, at)
         SELECT ?2, 'note', id, 'upsert', ?4 FROM notes
          WHERE user_id = ?2 AND folder_id IN (SELECT id FROM subtree)`,
      ).bind(id, userId, row.updated_at, now),
      c.env.DB.prepare(`${tree} DELETE FROM links WHERE source_note_id IN (${noteIds})`)
        .bind(id, userId, row.updated_at),
      c.env.DB.prepare(
        `${tree} UPDATE links SET target_note_id = (
           SELECT candidate.id FROM notes candidate
            WHERE candidate.user_id = links.user_id AND candidate.deleted_at IS NULL
              AND candidate.title_key = links.target_key
              AND candidate.id NOT IN (${noteIds})
            ORDER BY candidate.created_at ASC, candidate.id ASC LIMIT 1
         ) WHERE user_id = ?2 AND target_note_id IN (${noteIds})`,
      ).bind(id, userId, row.updated_at),
    ]
    if (ftsEnabled) {
      statements.push(
        c.env.DB.prepare(`${tree} DELETE FROM notes_fts WHERE note_id IN (${noteIds})`)
          .bind(id, userId, row.updated_at),
      )
    }
    statements.push(
      c.env.DB.prepare(
        `${tree} UPDATE notes SET folder_id = NULL, deleted_at = COALESCE(deleted_at, ?4),
          updated_at = MAX(updated_at + 1, ?4), rev = rev + 1
          WHERE user_id = ?2 AND folder_id IN (SELECT id FROM subtree)`,
      ).bind(id, userId, row.updated_at, now),
      c.env.DB.prepare(
        `${tree} DELETE FROM folders WHERE user_id = ?2 AND id IN (SELECT id FROM subtree)`,
      ).bind(id, userId, row.updated_at),
    )
    const results = await c.env.DB.batch(statements)
    if (!results.at(-1)?.meta.changes) throw ApiError.conflict('The folder changed elsewhere. Refresh and try again')
  }

  await broadcastCursor(c)
  return c.json({ ok: true })
})


async function loadFolder(db: D1Database, userId: string, id: string): Promise<Folder> {
  const row = await db
    .prepare(`SELECT ${FOLDER_SELECT} FROM folders f WHERE f.id = ?1 AND f.user_id = ?2`)
    .bind(id, userId)
    .first<FolderRow>()
  if (!row) throw ApiError.notFound('Folder not found')
  return toFolder(row)
}

interface FolderGraph {
  parents: Map<string, string | null>
  children: Map<string, string[]>
}

async function loadFolderGraph(db: D1Database, userId: string): Promise<FolderGraph> {
  const { results } = await db
    .prepare(`SELECT id, parent_id FROM folders WHERE user_id = ?1 AND deleted_at IS NULL`)
    .bind(userId)
    .all<{ id: string; parent_id: string | null }>()
  const parents = new Map<string, string | null>()
  const children = new Map<string, string[]>()
  for (const row of results) {
    parents.set(row.id, row.parent_id)
    const key = row.parent_id ?? ''
    const list = children.get(key) ?? []
    list.push(row.id)
    children.set(key, list)
  }
  return { parents, children }
}

function validateParent(
  graph: FolderGraph,
  parentId: string | null | undefined,
  selfId?: string,
): string | null {
  if (!parentId) return null
  if (!graph.parents.has(parentId)) throw ApiError.badRequest('The parent folder does not exist')

  const visited = new Set<string>()
  let cursor: string | null = parentId
  while (cursor) {
    if (cursor === selfId) throw ApiError.badRequest('A folder cannot be moved into its own descendant')
    if (visited.has(cursor)) throw ApiError.badRequest('The folder hierarchy contains a cycle')
    visited.add(cursor)
    cursor = graph.parents.get(cursor) ?? null
  }
  return parentId
}

function subtreeCteWithRevision(): string {
  return `WITH RECURSIVE subtree(id) AS (
    SELECT id FROM folders
     WHERE id = ?1 AND user_id = ?2 AND updated_at = ?3 AND deleted_at IS NULL
    UNION
    SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
     WHERE f.user_id = ?2 AND f.deleted_at IS NULL
  )`
}

export function parseFolderDeleteStrategy(value: unknown): 'move-up' | 'delete' {
  if (value === undefined || value === null || value === '') return 'move-up'
  if (value === 'move-up' || value === 'delete') return value
  throw ApiError.badRequest('strategy must be move-up or delete')
}

function folderDepth(graph: FolderGraph, id: string): number {
  let depth = 1
  let cursor = graph.parents.get(id) ?? null
  const guard = new Set<string>([id])
  while (cursor && !guard.has(cursor) && depth < 64) {
    guard.add(cursor)
    cursor = graph.parents.get(cursor) ?? null
    depth++
  }
  return depth
}

function subtreeHeight(graph: FolderGraph, rootId: string): number {
  let height = 1
  const visited = new Set<string>()
  const stack: Array<[string, number]> = [[rootId, 1]]
  while (stack.length) {
    const [id, depth] = stack.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    height = Math.max(height, depth)
    for (const child of graph.children.get(id) ?? []) stack.push([child, depth + 1])
  }
  return height
}
