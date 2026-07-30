import { BACKUP_INTERVALS, LIMITS, mergeSettings } from '@shared/constants'
import type { Env } from '../env'
import { initializeDatabase } from '../db/schema'
import { forEachConcurrent } from './concurrency'
import { runBackup } from './engine'

const USER_PAGE_SIZE = 100


export async function runScheduledBackups(env: Env): Promise<void> {
  try {
    await initializeDatabase(env)
  } catch (err) {
    console.error('[inkstone] Scheduled task: database is not ready', err)
    return
  }

  const now = Date.now()


  let afterUserId = ''
  while (true) {
    const { results: users } = await env.DB.prepare(
      `SELECT u.id, u.settings,
              (SELECT MAX(br.started_at) FROM backup_runs br WHERE br.user_id = u.id) AS last_at
         FROM users u
        WHERE u.id > ?1
          AND EXISTS (
            SELECT 1 FROM backup_targets bt WHERE bt.user_id = u.id AND bt.enabled = 1
          )
        ORDER BY u.id LIMIT ?2`,
    )
      .bind(afterUserId, USER_PAGE_SIZE)
      .all<{ id: string; settings: string; last_at: number | null }>()
    if (users.length === 0) break

    await forEachConcurrent(users, 2, async (user) => {
      try {
        const settings = mergeSettings(parse(user.settings))
        const interval = BACKUP_INTERVALS[settings.backup.schedule] ?? 0
        if (!interval) return


        if (user.last_at && now - user.last_at < interval - 5 * 60 * 1000) return

        const run = await runBackup(env, user.id, { trigger: 'cron' })
        console.log(
          `[inkstone] Scheduled backup ${user.id}: ${run.status}, ${run.results.length} targets, ${run.bytes} bytes`,
        )
      } catch (err) {
        console.error(`[inkstone] User ${user.id} scheduled backup failed:`, err)
      }
    })

    afterUserId = users[users.length - 1]!.id
    if (users.length < USER_PAGE_SIZE) break
  }

  await trimChangeLog(env)
}

async function trimChangeLog(env: Env): Promise<void> {
  try {
    let afterUserId = ''
    while (true) {
      const { results } = await env.DB.prepare(
        `SELECT DISTINCT user_id FROM changes WHERE user_id > ?1 ORDER BY user_id LIMIT ?2`,
      )
        .bind(afterUserId, USER_PAGE_SIZE)
        .all<{ user_id: string }>()
      if (results.length === 0) break
      for (const row of results) {
        await env.DB.prepare(
          `DELETE FROM changes WHERE user_id = ?1 AND seq < (
             SELECT MIN(seq) FROM (
               SELECT seq FROM changes WHERE user_id = ?1 ORDER BY seq DESC LIMIT ?2
             )
           )`,
        )
          .bind(row.user_id, LIMITS.changeLogKept)
          .run()
      }
      afterUserId = results[results.length - 1]!.user_id
      if (results.length < USER_PAGE_SIZE) break
    }
  } catch (err) {
    console.warn('[inkstone] Failed to trim the change log:', err)
  }
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}
