import type { Context } from 'hono'
import { currentCursor, recordChange, type ChangeEntity, type ChangeOp } from '../db/writes'
import { notifySyncHub } from '../realtime/sync-hub'
import type { AppBindings } from '../env'


export function originOf(c: Context<AppBindings>): string | null {
  return c.req.header('X-Inkstone-Origin')?.slice(0, 128) || null
}


export async function commitChange(
  c: Context<AppBindings>,
  entity: ChangeEntity,
  entityId: string,
  op: ChangeOp,
): Promise<number> {
  const userId = c.get('userId')
  const cursor = await recordChange(c.env.DB, userId, entity, entityId, op)
  c.executionCtx?.waitUntil(notifySyncHub(c.env.SYNC_HUB, userId, cursor, originOf(c)))
  return cursor
}


export async function broadcastCursor(c: Context<AppBindings>): Promise<number> {
  const userId = c.get('userId')
  const cursor = await currentCursor(c.env.DB, userId)
  c.executionCtx?.waitUntil(notifySyncHub(c.env.SYNC_HUB, userId, cursor, originOf(c)))
  return cursor
}
