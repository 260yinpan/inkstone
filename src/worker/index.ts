import { createApp } from './app'
import { runAttachmentCleanup } from './attachments/cleanup'
import { runScheduledBackups } from './backup/scheduler'
import type { Env } from './env'

export { SyncHub } from './realtime/sync-hub'
export { CredentialVault } from './durable/credential-vault'

const app = createApp()

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx)
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([runScheduledBackups(env), runAttachmentCleanup(env)]).then(() => undefined))
  },
} satisfies ExportedHandler<Env>
