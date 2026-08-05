import { Hono } from 'hono'
import type { AppBindings } from '../env'
import { ApiError } from '../lib/errors'
import { JSON_BODY_LIMITS, readJson } from '../lib/request'
import { requireAuth } from '../middleware/auth'
import {
  getMcpPreferences,
  isMcpEnabled,
  setMcpEnabled,
  updateMcpPreferences,
} from '../mcp/settings'

export const mcpSettingsRoutes = new Hono<AppBindings>()

mcpSettingsRoutes.use('*', requireAuth)

mcpSettingsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const preferences = await getMcpPreferences(c.env.DB, user.id)
  const grants = c.env.OAUTH_PROVIDER
    ? await collectGrants(c.env.OAUTH_PROVIDER, user.id)
    : []
  const origin = configuredOrigin(c.req.raw, c.env.PUBLIC_URL)
  return c.json({
    enabled: await isMcpEnabled(c.env.DB),
    canManageGlobal: user.role === 'owner',
    endpoint: `${origin}/mcp`,
    oauth: true,
    preferences,
    grants,
    privacy: {
      publicEndpoint: false,
      perUserIndex: true,
      externalClientReceivesSelectedContent: true,
    },
  })
})

mcpSettingsRoutes.put('/', async (c) => {
  const user = c.get('user')
  const body = await readJson<{
    enabled?: boolean
    writeEnabled?: boolean
    trashEnabled?: boolean
  }>(c, JSON_BODY_LIMITS.settings)

  for (const key of ['enabled', 'writeEnabled', 'trashEnabled'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      throw ApiError.badRequest(`${key} must be a boolean`)
    }
  }
  if (body.enabled !== undefined) {
    if (user.role !== 'owner') throw ApiError.forbidden('Only the owner can enable or disable MCP')
    await setMcpEnabled(c.env.DB, body.enabled)
  }

  const preferences = await updateMcpPreferences(c.env.DB, user.id, {
    ...(body.writeEnabled !== undefined ? { writeEnabled: body.writeEnabled } : {}),
    ...(body.trashEnabled !== undefined ? { trashEnabled: body.trashEnabled } : {}),
  })
  return c.json({
    enabled: await isMcpEnabled(c.env.DB),
    preferences,
    reconnectRequired: body.writeEnabled !== undefined || body.trashEnabled !== undefined,
  })
})

mcpSettingsRoutes.delete('/grants/:id', async (c) => {
  if (!c.env.OAUTH_PROVIDER) throw new ApiError(503, 'internal', 'OAuth is unavailable')
  await c.env.OAUTH_PROVIDER.revokeGrant(c.req.param('id'), c.get('userId'))
  return c.json({ ok: true })
})

mcpSettingsRoutes.post('/grants/revoke-all', async (c) => {
  if (!c.env.OAUTH_PROVIDER) throw new ApiError(503, 'internal', 'OAuth is unavailable')
  const grants = await collectGrantIds(c.env.OAUTH_PROVIDER, c.get('userId'))
  await Promise.all(grants.map((id) => c.env.OAUTH_PROVIDER!.revokeGrant(id, c.get('userId'))))
  return c.json({ ok: true, revoked: grants.length })
})

async function collectGrants(
  oauth: NonNullable<AppBindings['Bindings']['OAUTH_PROVIDER']>,
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const output: Array<Record<string, unknown>> = []
  let cursor: string | undefined
  do {
    const page = await oauth.listUserGrants(userId, { limit: 100, cursor })
    output.push(...page.items.map((grant) => ({
      id: grant.id,
      clientId: grant.clientId,
      clientName: typeof grant.metadata?.clientName === 'string' ? grant.metadata.clientName : 'MCP client',
      clientUri: typeof grant.metadata?.clientUri === 'string' ? grant.metadata.clientUri : null,
      scopes: grant.scope,
      createdAt: grant.createdAt * 1000,
      expiresAt: grant.expiresAt ? grant.expiresAt * 1000 : null,
    })))
    cursor = page.cursor
  } while (cursor && output.length < 500)
  return output
}

async function collectGrantIds(
  oauth: NonNullable<AppBindings['Bindings']['OAUTH_PROVIDER']>,
  userId: string,
): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | undefined
  do {
    const page = await oauth.listUserGrants(userId, { limit: 100, cursor })
    ids.push(...page.items.map((grant) => grant.id))
    cursor = page.cursor
  } while (cursor && ids.length < 500)
  return ids
}

function configuredOrigin(request: Request, configured?: string): string {
  if (!configured) return new URL(request.url).origin
  try {
    return new URL(configured).origin
  } catch {
    return new URL(request.url).origin
  }
}
