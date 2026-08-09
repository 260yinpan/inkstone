const LOGIN_ATTEMPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export interface OperationalPurgeResult {
  sessions: number
  shareAssetSessions: number
  loginAttempts: number
}

export async function purgeExpiredOperationalData(
  db: D1Database,
  now = Date.now(),
  limit = 500,
): Promise<OperationalPurgeResult> {
  const capped = Math.max(1, Math.min(1_000, Math.trunc(limit)))
  const [sessions, shareAssetSessions, loginAttempts] = await db.batch([
    db.prepare(
      `DELETE FROM sessions WHERE id IN (
         SELECT id FROM sessions WHERE expires_at <= ?1 ORDER BY expires_at, id LIMIT ?2
       )`,
    ).bind(now, capped),
    db.prepare(
      `DELETE FROM share_asset_sessions WHERE id IN (
         SELECT id FROM share_asset_sessions WHERE expires_at <= ?1 ORDER BY expires_at, id LIMIT ?2
       )`,
    ).bind(now, capped),
    db.prepare(
      `DELETE FROM login_attempts WHERE key IN (
         SELECT key FROM login_attempts WHERE last_fail_at < ?1 ORDER BY last_fail_at, key LIMIT ?2
       )`,
    ).bind(now - LOGIN_ATTEMPT_RETENTION_MS, capped),
  ])
  return {
    sessions: sessions.meta.changes ?? 0,
    shareAssetSessions: shareAssetSessions.meta.changes ?? 0,
    loginAttempts: loginAttempts.meta.changes ?? 0,
  }
}
