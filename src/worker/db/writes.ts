/** Keeps tags, backlinks, full-text indexes, and change records consistent with note writes. */
import { LIMITS } from '@shared/constants'
import { extractTags, extractWikiLinks, normalizeLinkKey, segmentCJK } from '@shared/markdown-utils'
import { truncateText } from '@shared/text-utils'
import { newId } from '../lib/id'


export type ChangeEntity = 'note' | 'folder' | 'tag' | 'settings' | 'profile'
export type ChangeOp = 'upsert' | 'delete'


export const LINK_TARGET_SUBQUERY = `(SELECT candidate.id FROM notes candidate
  WHERE candidate.user_id = links.user_id AND candidate.deleted_at IS NULL
    AND candidate.title_key = links.target_key
  ORDER BY candidate.created_at ASC, candidate.id ASC LIMIT 1)`

export function changeStatement(
  db: D1Database,
  userId: string,
  entity: ChangeEntity,
  entityId: string,
  op: ChangeOp,
  at = Date.now(),
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO changes (user_id, entity, entity_id, op, at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(userId, entity, entityId, op, at)
}

export async function recordChange(
  db: D1Database,
  userId: string,
  entity: ChangeEntity,
  entityId: string,
  op: ChangeOp,
): Promise<number> {
  await changeStatement(db, userId, entity, entityId, op).run()
  return currentCursor(db, userId)
}

export async function currentCursor(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT MAX(seq) AS seq FROM changes WHERE user_id = ?1`)
    .bind(userId)
    .first<{ seq: number | null }>()
  return row?.seq ?? 0
}

export interface SyncDerivedOptions {
  db: D1Database
  userId: string
  noteId: string
  title: string
  content: string
  ftsEnabled: boolean

  titleChanged?: boolean

  previousTitle?: string

  expectedRev?: number

  expectedContentHash?: string
  expectedTitle?: string
  expectedUpdatedAt?: number

  deleted?: boolean
}


export function buildNoteDerivedStatements(
  opts: SyncDerivedOptions,
): { statements: D1PreparedStatement[]; tags: string[] } {
  const { db, userId, noteId, title, content, ftsEnabled } = opts
  const now = Date.now()
  const tagNames = extractTags(content)
  const links = extractWikiLinks(content)
  const tagRows = JSON.stringify(tagNames.map((name) => ({ id: newId(), name })))
  const linkRows = JSON.stringify(links.map((link) => ({ key: link.key, target: link.target })))
  const statements: D1PreparedStatement[] = []
  const guarded = opts.expectedRev !== undefined ||
    opts.expectedContentHash !== undefined ||
    opts.expectedTitle !== undefined ||
    opts.expectedUpdatedAt !== undefined
  const guardValues: unknown[] = [noteId, userId]
  const checks = ['id = ?1', 'user_id = ?2']
  if (opts.expectedRev !== undefined) {
    guardValues.push(opts.expectedRev)
    checks.push(`rev = ?${guardValues.length}`)
  }
  if (opts.expectedContentHash !== undefined) {
    guardValues.push(opts.expectedContentHash)
    checks.push(`content_hash = ?${guardValues.length}`)
  }
  if (opts.expectedTitle !== undefined) {
    guardValues.push(opts.expectedTitle)
    checks.push(`title = ?${guardValues.length}`)
  }
  if (opts.expectedUpdatedAt !== undefined) {
    guardValues.push(opts.expectedUpdatedAt)
    checks.push(`updated_at = ?${guardValues.length}`)
  }
  const guard = guarded
    ? `EXISTS (SELECT 1 FROM notes WHERE ${checks.join(' AND ')})`
    : '1 = 1'
  if (!guarded) guardValues.length = 0

  statements.push(
    db
      .prepare(
        `UPDATE notes SET title_key = ?1
          WHERE id = ?2 AND user_id = ?3 AND ${shiftPlaceholders(guard, 3)}`,
      )
      .bind(normalizeLinkKey(title), noteId, userId, ...guardValues),
  )

  statements.push(
    db
      .prepare(
        `INSERT INTO tags (id, user_id, name, color, created_at)
         SELECT json_extract(j.value, '$.id'), ?1, json_extract(j.value, '$.name'), NULL, ?2
           FROM json_each(?3) AS j
          WHERE ${shiftPlaceholders(guard, 3)}
         ON CONFLICT(user_id, name) DO NOTHING`,
      )
      .bind(userId, now, tagRows, ...guardValues),
    db
      .prepare(
        `DELETE FROM note_tags WHERE note_id = ?1
          AND ${shiftPlaceholders(guard, 1)}`,
      )
      .bind(noteId, ...guardValues),
    db
      .prepare(
        `INSERT INTO note_tags (note_id, tag_id)
         SELECT ?1, t.id
           FROM tags t JOIN json_each(?2) AS j
             ON t.name = json_extract(j.value, '$.name')
          WHERE t.user_id = ?3 AND ${shiftPlaceholders(guard, 3)}
         ON CONFLICT DO NOTHING`,
      )
      .bind(noteId, tagRows, userId, ...guardValues),
  )

  statements.push(
    db
      .prepare(
        `DELETE FROM links WHERE source_note_id = ?1
          AND ${shiftPlaceholders(guard, 1)}`,
      )
      .bind(noteId, ...guardValues),
  )
  if (!opts.deleted) {
    statements.push(
      db
        .prepare(
          `INSERT INTO links (source_note_id, target_key, target_title, target_note_id, user_id)
           SELECT ?1,
                  json_extract(j.value, '$.key'),
                  json_extract(j.value, '$.target'),
                  (SELECT id FROM notes
                    WHERE user_id = ?2 AND deleted_at IS NULL
                      AND title_key = json_extract(j.value, '$.key')
                    ORDER BY created_at ASC, id ASC LIMIT 1),
                  ?2
             FROM json_each(?3) AS j
            WHERE ${shiftPlaceholders(guard, 3)}
           ON CONFLICT(source_note_id, target_key) DO UPDATE SET
             target_title = excluded.target_title,
             target_note_id = excluded.target_note_id`,
        )
        .bind(noteId, userId, linkRows, ...guardValues),
    )
  }

  if (ftsEnabled) {
    statements.push(
      db
        .prepare(
          `DELETE FROM notes_fts WHERE note_id = ?1
            AND ${shiftPlaceholders(guard, 1)}`,
        )
        .bind(noteId, ...guardValues),
    )
    if (!opts.deleted) {
      statements.push(
        db
          .prepare(
            `INSERT INTO notes_fts (note_id, user_id, title, body)
             SELECT ?1, ?2, ?3, ?4 WHERE ${shiftPlaceholders(guard, 4)}`,
          )
          .bind(
            noteId,
            userId,
            segmentCJK(title),
            segmentCJK(truncateText(content, LIMITS.ftsContentChars)),
            ...guardValues,
          ),
      )
    }
  }

  if (opts.titleChanged !== false) {
    const currentKey = normalizeLinkKey(title)
    const previousKey = normalizeLinkKey(opts.previousTitle ?? title)
    statements.push(
      db
        .prepare(
          `UPDATE links SET target_note_id = ${LINK_TARGET_SUBQUERY}
             WHERE user_id = ?1 AND target_key IN (?2, ?3)
               AND ${shiftPlaceholders(guard, 3)}`,
        )
        .bind(userId, currentKey, previousKey, ...guardValues),
    )
  }

  return { statements, tags: tagNames }
}

function shiftPlaceholders(sql: string, offset: number): string {
  return sql.replace(/\?(\d+)/g, (_match, value: string) => `?${Number(value) + offset}`)
}

export async function pruneOrphanTags(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `DELETE FROM tags WHERE user_id = ?1 AND id NOT IN (SELECT tag_id FROM note_tags)`,
    )
    .bind(userId)
    .run()
}

export async function runBatched(
  db: D1Database,
  statements: D1PreparedStatement[],
  chunk = 40,
): Promise<void> {
  for (let i = 0; i < statements.length; i += chunk) {
    const slice = statements.slice(i, i + chunk)
    if (slice.length) await db.batch(slice)
  }
}
