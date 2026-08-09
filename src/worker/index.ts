import { runAttachmentCleanup } from './attachments/cleanup'
import { runScheduledBackups } from './backup/scheduler'
import type { Env } from './env'
import { initializeDatabase } from './db/schema'
import { drainAllFtsQueues } from './db/fts'
import { drainAiIndexQueue } from './mcp/ai-search'
import { createOAuthProvider, providerForScheduled } from './mcp/oauth'
import { purgeRevokedMcpApiKeys } from './mcp/api-keys'
import { purgeExpiredMcpOperations } from './mcp/operations'
import { purgeExpiredOperationalData } from './lib/maintenance'

export { SyncHub } from './realtime/sync-hub'
export { CredentialVault } from './durable/credential-vault'

// Codex CLI drops the `iss`/`issuer` callback parameter while its rmcp
// dependency enforces it whenever the authorization server advertises
// `authorization_response_iss_parameter_supported` (openai/codex#31573), so
// login fails even though the parameter is on the wire. Serve the metadata
// without that flag to keep codex compatible; `iss`/`issuer` are still
// appended to callbacks for conforming clients such as Claude Code.
const OAUTH_AUTHORIZATION_SERVER_METADATA = '/.well-known/oauth-authorization-server'

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const provider = createOAuthProvider(request, env)
    if (new URL(request.url).pathname === OAUTH_AUTHORIZATION_SERVER_METADATA) {
      return oauthMetadataWithoutIssParameter(provider, request, env, ctx)
    }
    return provider.fetch(request, env, ctx)
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      await initializeDatabase(env)
      await Promise.all([
        runScheduledBackups(env),
        runAttachmentCleanup(env),
        purgeExpiredMcpOperations(env.DB),
        purgeExpiredOperationalData(env.DB),
        purgeRevokedMcpApiKeys(env.DB),
        providerForScheduled(env).purgeExpiredData(env, { batchSize: 100 }),
        drainAiIndexQueue(env, 300),
        drainAllFtsQueues(env.DB),
      ])
    })())
  },
} satisfies ExportedHandler<Env>

async function oauthMetadataWithoutIssParameter(
  provider: ReturnType<typeof createOAuthProvider>,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const response = await provider.fetch(request, env, ctx)
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.ok || !contentType.includes('application/json')) return response
  const metadata = (await response.json()) as Record<string, unknown>
  delete metadata.authorization_response_iss_parameter_supported
  return new Response(JSON.stringify(metadata), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
