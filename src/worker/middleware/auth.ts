import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { getCookie, setCookie } from 'hono/cookie'
import {
  CLIENT_HEADER,
  SESSION_COOKIE,
  SESSION_RENEW_BEFORE_MS,
  SESSION_TTL_MS,
} from '@shared/constants'
import { destroySession, renewSession, resolveSession } from '../lib/session-store'
import { ApiError } from '../lib/errors'
import type { AppBindings, Variables } from '../env'

interface UserRow {
  id: string
  username: string
  login: string
  name: string
  avatar_url: string
  role: 'owner' | 'member'
  settings: string
  created_at: number
}

export const USER_COLUMNS = `id, username, login, name, avatar_url, role, settings, created_at`

export function rowToUser(row: UserRow): Variables['user'] {
  return {
    id: row.id,
    username: row.username,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,

    role: row.role === 'owner' ? 'owner' : 'member',
    createdAt: row.created_at,
    settingsRaw: row.settings,
  }
}


export const loadSession = createMiddleware<AppBindings>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)

  if (token) {
    const session = await resolveSession(c.env.DB, token)
    if (session) {
      const row = await c.env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?1`)
        .bind(session.userId)
        .first<UserRow>()

      if (row) {
        c.set('user', rowToUser(row))
        c.set('userId', row.id)
        c.set('sessionId', session.id)

        if (session.expiresAt - Date.now() < SESSION_RENEW_BEFORE_MS) {
          await renewSession(c.env.DB, session.id)
          writeSessionCookie(c, token)
        }
        const now = Date.now()
        c.executionCtx?.waitUntil(
          c.env.DB.prepare(`UPDATE users SET last_seen_at = ?1 WHERE id = ?2 AND last_seen_at < ?3`)
            .bind(now, row.id, now - 5 * 60 * 1000)
            .run()
            .catch(() => {}),
        )
      } else {
        await destroySession(c.env.DB, token)
        clearSessionCookie(c)
      }
    } else {
      clearSessionCookie(c)
    }
  }

  await next()
})

export const requireAuth = createMiddleware<AppBindings>(async (c, next) => {
  if (!c.get('userId')) throw ApiError.unauthenticated()
  await next()
})

export const requireClientHeader = createMiddleware<AppBindings>(async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (c.req.header(CLIENT_HEADER) !== '1') {
      throw new ApiError(403, 'forbidden', 'Missing client identification header. Refresh and try again')
    }
  }
  await next()
})

export function sessionCookieString(requestUrl: string, token: string): string {
  const secure = new URL(requestUrl).protocol === 'https:'
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function writeSessionCookie(c: Context<AppBindings>, token: string): void {
  c.header('Set-Cookie', sessionCookieString(c.req.url, token), { append: true })
}

export function clearSessionCookie(c: Context<AppBindings>): void {
  setCookie(c, SESSION_COOKIE, '', {
    path: '/',
    httpOnly: true,
    maxAge: 0,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
  })
}
