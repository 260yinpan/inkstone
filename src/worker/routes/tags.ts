import { Hono } from 'hono'
import type { Context } from 'hono'
import { LIMITS } from '@shared/constants'
import { countText, deriveExcerpt, deriveTitle, replaceTagInContent } from '@shared/markdown-utils'
import { truncateText, utf8ByteLength } from '@shared/text-utils'
import type { AppBindings } from '../env'
import { toTag, type TagRow } from '../db/rows'
import { buildNoteDerivedStatements } from '../db/writes'
import { sha256Hex } from '../lib/encoding'
import { ApiError } from '../lib/errors'
import { newId } from '../lib/id'
import { broadcastCursor } from '../lib/notify'
import { JSON_BODY_LIMITS, readJson } from '../lib/request'
import { requireAuth } from '../middleware/auth'

export const tagsRoutes = new Hono<AppBindings>()

tagsRoutes.use('*', requireAuth)

const TAG_SELECT = `t.id, t.name, t.color, t.created_at,
  (SELECT COUNT(*) FROM note_tags nt JOIN notes n ON n.id = nt.note_id
     WHERE nt.tag_id = t.id AND n.user_id = t.user_id
       AND n.deleted_at IS NULL AND n.is_archived = 0) AS note_count`

tagsRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${TAG_SELECT} FROM tags t WHERE t.user_id = ?1 ORDER BY t.name COLLATE NOCASE ASC`,
  )
    .bind(c.get('userId'))
    .all<TagRow>()
  return c.json({ tags: results.map(toTag) })
})

tagsRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const body = await readJson<{ name?: string; color?: string | null }>(c, JSON_BODY_LIMITS.small)

  const tag = await c.env.DB.prepare(`SELECT id, name, color FROM tags WHERE id = ?1 AND user_id = ?2`)
    .bind(id, userId)
    .first<{ id: string; name: string; color: string | null }>()
  if (!tag) throw ApiError.notFound('Tag not found')

  if (body.color !== undefined && body.color !== null && typeof body.color !== 'string') {
    throw ApiError.badRequest('color must be a string or null')
  }
  if (body.name !== undefined && typeof body.name !== 'string') {
    throw ApiError.badRequest('name must be a string')
  }

  const color = body.color === undefined ? tag.color : body.color ? truncateText(body.color, 32) : null

  if (typeof body.name === 'string') {
    const next = body.name.trim().replace(/^#+/, '')
    if (!next) throw ApiError.badRequest('Tag name cannot be empty')
    if (next.length > LIMITS.tagNameMaxLength) throw ApiError.badRequest('Tag name is too long')
    if (/[\s#]/.test(next)) throw ApiError.badRequest('Tag names cannot contain spaces or #')

    if (next !== tag.name) {
      const rewritten = await rewriteTagInNotes(c, userId, id, tag.name, next)
      const now = Date.now()
      const targetId = newId()
      const explicitColor = body.color !== undefined ? 1 : 0
      const sourceGuard = `EXISTS (SELECT 1 FROM tags
        WHERE id = ?1 AND user_id = ?2 AND name = ?3)`
      const statements = [
        c.env.DB.prepare(
          `INSERT INTO tags (id, user_id, name, color, created_at)
           SELECT ?4, ?2, ?5,
                  CASE WHEN ?6 = 1 THEN ?7 ELSE source.color END,
                  ?8
             FROM tags source
            WHERE source.id = ?1 AND source.user_id = ?2 AND source.name = ?3
           ON CONFLICT(user_id, name) DO UPDATE SET
             color = CASE WHEN ?6 = 1 THEN ?7 ELSE COALESCE(tags.color, excluded.color) END`,
        ).bind(id, userId, tag.name, targetId, next, explicitColor, color, now),
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO note_tags (note_id, tag_id)
           SELECT nt.note_id, target.id
             FROM note_tags nt
             JOIN tags target ON target.user_id = ?2 AND target.name = ?4
            WHERE nt.tag_id = ?1 AND ${sourceGuard}`,
        ).bind(id, userId, tag.name, next),
        c.env.DB.prepare(`DELETE FROM note_tags WHERE tag_id = ?1 AND ${sourceGuard}`)
          .bind(id, userId, tag.name),
        c.env.DB.prepare(
          `INSERT INTO changes (user_id, entity, entity_id, op, at)
           SELECT ?2, 'tag', target.id, 'upsert', ?4
             FROM tags target WHERE target.user_id = ?2 AND target.name = ?5 AND ${sourceGuard}`,
        ).bind(id, userId, tag.name, now, next),
        c.env.DB.prepare(
          `INSERT INTO changes (user_id, entity, entity_id, op, at)
           SELECT ?2, 'tag', ?1, 'delete', ?4 WHERE ${sourceGuard}`,
        ).bind(id, userId, tag.name, now),
        c.env.DB.prepare(`DELETE FROM tags WHERE id = ?1 AND user_id = ?2 AND name = ?3`)
          .bind(id, userId, tag.name),
      ]
      const results = await c.env.DB.batch(statements)
      if (!results.at(-1)?.meta.changes) {
        throw ApiError.conflict('The tag changed elsewhere. Refresh and try again')
      }
      await broadcastCursor(c)
      return c.json({ ok: true, renamed: rewritten })
    }
  }

  if (color !== tag.color) {
    const now = Date.now()
    const update = c.env.DB.prepare(
      `UPDATE tags SET color = ?1 WHERE id = ?2 AND user_id = ?3 AND name = ?4 AND color IS ?5`,
    ).bind(color, id, userId, tag.name, tag.color)
    const change = c.env.DB.prepare(
      `INSERT INTO changes (user_id, entity, entity_id, op, at)
       SELECT ?1, 'tag', ?2, 'upsert', ?3
        WHERE EXISTS (SELECT 1 FROM tags WHERE id = ?2 AND user_id = ?1 AND color IS ?4)`,
    ).bind(userId, id, now, color)
    const [updated] = await c.env.DB.batch([update, change])
    if (!updated?.meta.changes) throw ApiError.conflict('The tag changed elsewhere. Refresh and try again')
    await broadcastCursor(c)
  }
  const row = await c.env.DB.prepare(`SELECT ${TAG_SELECT} FROM tags t WHERE t.id = ?1 AND t.user_id = ?2`)
    .bind(id, userId)
    .first<TagRow>()
  return c.json(row ? toTag(row) : { ok: true })
})

tagsRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const tag = await c.env.DB.prepare(`SELECT id, name FROM tags WHERE id = ?1 AND user_id = ?2`)
    .bind(id, userId)
    .first<{ id: string; name: string }>()
  if (!tag) throw ApiError.notFound('Tag not found')

  const affected = await rewriteTagInNotes(c, userId, id, tag.name, null)

  const now = Date.now()
  const guard = `EXISTS (SELECT 1 FROM tags WHERE id = ?1 AND user_id = ?2 AND name = ?3)`
  const statements = [
    c.env.DB.prepare(`DELETE FROM note_tags WHERE tag_id = ?1 AND ${guard}`)
      .bind(id, userId, tag.name),
    c.env.DB.prepare(
      `INSERT INTO changes (user_id, entity, entity_id, op, at)
       SELECT ?2, 'tag', ?1, 'delete', ?4 WHERE ${guard}`,
    ).bind(id, userId, tag.name, now),
    c.env.DB.prepare(`DELETE FROM tags WHERE id = ?1 AND user_id = ?2 AND name = ?3`)
      .bind(id, userId, tag.name),
  ]
  const outcomes = await c.env.DB.batch(statements)
  if (!outcomes.at(-1)?.meta.changes) throw ApiError.conflict('The tag changed elsewhere. Refresh and try again')
  await broadcastCursor(c)
  return c.json({ ok: true, affected })
})

async function rewriteTagInNotes(
  c: Context<AppBindings>,
  userId: string,
  tagId: string,
  from: string,
  to: string | null,
): Promise<number> {
  const { ftsEnabled } = c.get('database')
  const { results } = await c.env.DB.prepare(
    `SELECT n.id FROM notes n
       JOIN note_tags nt ON nt.note_id = n.id
      WHERE nt.tag_id = ?1 AND n.user_id = ?2`,
  )
    .bind(tagId, userId)
    .all<{ id: string }>()

  let rewritten = 0
  for (const candidate of results) {
    let complete = false
    for (let attempt = 0; attempt < 5; attempt++) {
      const note = await c.env.DB.prepare(
        `SELECT id, title, content, rev, updated_at, deleted_at
           FROM notes WHERE id = ?1 AND user_id = ?2`,
      )
        .bind(candidate.id, userId)
        .first<{
          id: string
          title: string
          content: string
          rev: number
          updated_at: number
          deleted_at: number | null
        }>()
      if (!note) {
        complete = true
        break
      }
      const content = replaceTagInContent(note.content, from, to)
      if (content === note.content) {
        complete = true
        break
      }

      const title = deriveTitle(content)
      const { words, chars } = countText(content)
      const hash = await sha256Hex(content)
      const now = Math.max(Date.now(), note.updated_at + 1)
      const nextRev = note.rev + 1
      const mutationGuard = `EXISTS (SELECT 1 FROM notes
        WHERE id = ?1 AND user_id = ?2 AND rev = ?3
          AND content_hash = ?4 AND title = ?5 AND updated_at = ?6)`
      const mutationValues = [note.id, userId, nextRev, hash, title, now] as const
      const update = c.env.DB.prepare(
        `UPDATE notes SET title = ?1, content = ?2, excerpt = ?3, word_count = ?4, char_count = ?5,
           content_hash = ?6, rev = ?7, updated_at = ?8
          WHERE id = ?9 AND user_id = ?10 AND rev = ?11`,
      ).bind(
        title,
        content,
        deriveExcerpt(content),
        words,
        chars,
        hash,
        nextRev,
        now,
        note.id,
        userId,
        note.rev,
      )
      const snapshot = c.env.DB.prepare(
        `INSERT INTO note_versions (id, note_id, user_id, title, content, size, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
          WHERE ${shiftSqlPlaceholders(mutationGuard, 7)}`,
      ).bind(
        newId(),
        note.id,
        userId,
        note.title,
        note.content,
        utf8ByteLength(note.content),
        now,
        ...mutationValues,
      )
      const trim = c.env.DB.prepare(
        `DELETE FROM note_versions WHERE note_id = ?1
           AND ${shiftSqlPlaceholders(mutationGuard, 1)}
           AND id NOT IN (
             SELECT id FROM note_versions WHERE note_id = ?1 ORDER BY created_at DESC LIMIT ?8
           )`,
      ).bind(note.id, ...mutationValues, LIMITS.versionsPerNote)
      const statements: D1PreparedStatement[] = [update, snapshot, trim]
      if (note.deleted_at === null) {
        statements.push(...buildNoteDerivedStatements({
          db: c.env.DB,
          userId,
          noteId: note.id,
          title,
          content,
          ftsEnabled,
          titleChanged: title !== note.title,
          previousTitle: note.title,
          expectedRev: nextRev,
          expectedContentHash: hash,
          expectedTitle: title,
          expectedUpdatedAt: now,
        }).statements)
      }
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO changes (user_id, entity, entity_id, op, at)
           SELECT ?1, 'note', ?2, 'upsert', ?3
            WHERE ${shiftSqlPlaceholders(mutationGuard, 3)}`,
        ).bind(userId, note.id, now, ...mutationValues),
      )
      const [updated] = await c.env.DB.batch(statements)
      if (updated?.meta.changes) {
        rewritten++
        complete = true
        break
      }
    }
    if (!complete) {
      throw ApiError.conflict(`Some notes are still being edited. Safely completed ${rewritten} notes; try again later`)
    }
  }
  return rewritten
}

function shiftSqlPlaceholders(sql: string, offset: number): string {
  return sql.replace(/\?(\d+)/g, (_match, value: string) => `?${Number(value) + offset}`)
}
