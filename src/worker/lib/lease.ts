import { ApiError } from './errors'
import { newId } from './id'


export async function acquireLease(
  db: D1Database,
  key: string,
  ttlMs: number,
  conflictMessage: string,
): Promise<() => Promise<void>> {
  const token = newId()
  const now = Date.now()
  const value = JSON.stringify({ token, expiresAt: now + ttlMs })
  const acquired = await db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE COALESCE(CAST(json_extract(
         CASE WHEN json_valid(app_meta.value) THEN app_meta.value ELSE '{}' END,
         '$.expiresAt'
       ) AS INTEGER), 0) < ?3`,
  ).bind(key, value, now).run()
  if (!acquired.meta.changes) throw ApiError.conflict(conflictMessage)

  let released = false
  return async () => {
    if (released) return
    released = true
    await db.prepare(
      `DELETE FROM app_meta WHERE key = ?1 AND json_extract(value, '$.token') = ?2`,
    ).bind(key, token).run().catch((error) => {
      console.warn(`[inkstone] Task lock ${key} will release automatically after timeout:`, error)
    })
  }
}
