export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(key, value)
    .run()
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM app_meta WHERE key = ?1`)
    .bind(key)
    .first<{ value: string }>()
  return row?.value ?? null
}
