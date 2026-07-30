import { LIMITS } from '@shared/constants'
import { segmentCJK } from '@shared/markdown-utils'
import { truncateText } from '@shared/text-utils'

interface IndexableNote {
  id: string
  title: string
  content: string
  rev: number
  content_hash: string
  updated_at: number
}


export async function rebuildFtsIndex(db: D1Database, userId: string): Promise<number> {
  const boundary = await db
    .prepare(`SELECT MAX(id) AS id FROM notes WHERE user_id = ?1 AND deleted_at IS NULL`)
    .bind(userId)
    .first<{ id: string | null }>()
  const lastId = boundary?.id
  if (!lastId) {
    await db.prepare(`DELETE FROM notes_fts WHERE user_id = ?1`).bind(userId).run()
    return 0
  }

  let cursor = ''
  let indexed = 0
  while (cursor < lastId) {
    const { results } = await db
      .prepare(
        `SELECT id, title, content, rev, content_hash, updated_at FROM notes
          WHERE user_id = ?1 AND deleted_at IS NULL AND id > ?2 AND id <= ?3
          ORDER BY id ASC LIMIT 25`,
      )
      .bind(userId, cursor, lastId)
      .all<IndexableNote>()
    if (!results.length) break

    const statements: D1PreparedStatement[] = []
    for (const row of results) {
      const guard = `EXISTS (SELECT 1 FROM notes WHERE id = ?1 AND user_id = ?2
        AND deleted_at IS NULL AND rev = ?3 AND content_hash = ?4
        AND title = ?5 AND updated_at = ?6)`
      statements.push(
        db
          .prepare(
            `DELETE FROM notes_fts WHERE note_id = ?1 AND user_id = ?2
              AND ${shiftPlaceholders(guard, 2)}`,
          )
          .bind(row.id, userId, row.id, userId, row.rev, row.content_hash, row.title, row.updated_at),
        db
          .prepare(
            `INSERT INTO notes_fts (note_id, user_id, title, body)
             SELECT ?1, ?2, ?3, ?4 WHERE ${shiftPlaceholders(guard, 4)}`,
          )
          .bind(
            row.id,
            userId,
            segmentCJK(row.title),
            segmentCJK(truncateText(row.content, LIMITS.ftsContentChars)),
            row.id,
            userId,
            row.rev,
            row.content_hash,
            row.title,
            row.updated_at,
          ),
      )
    }
    const batch = await db.batch(statements)
    for (let index = 1; index < batch.length; index += 2) {
      indexed += batch[index]?.meta.changes ?? 0
    }
    cursor = results[results.length - 1]!.id
  }

  await db
    .prepare(
      `DELETE FROM notes_fts WHERE user_id = ?1 AND NOT EXISTS (
         SELECT 1 FROM notes n WHERE n.id = notes_fts.note_id
           AND n.user_id = ?1 AND n.deleted_at IS NULL
       )`,
    )
    .bind(userId)
    .run()
  return indexed
}

function shiftPlaceholders(sql: string, offset: number): string {
  return sql.replace(/\?(\d+)/g, (_match, value: string) => `?${Number(value) + offset}`)
}
