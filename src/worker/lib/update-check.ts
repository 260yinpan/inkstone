import {
  APP_VERSION,
  GITHUB_PACKAGE_URL,
  GITHUB_REPOSITORY_URL,
} from '@shared/constants'
import type { UpdateCheckResponse, UpdateCheckStatus } from '@shared/types'
import { isValidVersion } from '@shared/version'

export const UPDATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const UPDATE_CHECK_LEASE_MS = 15_000
const UPDATE_FETCH_TIMEOUT_MS = 5_000
const MAX_PACKAGE_RESPONSE_BYTES = 64 * 1024
const CACHE_KEY = 'repository-version-cache-v1'
const LEASE_KEY = 'repository-version-check-lease-v1'

interface CachedVersion {
  latestVersion: string | null
  checkedAt: number
  status: UpdateCheckStatus
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export async function checkRepositoryVersion(
  db: D1Database,
  options: {
    fetcher?: Fetcher
    now?: number
    timeoutMs?: number
  } = {},
): Promise<UpdateCheckResponse> {
  const now = options.now ?? Date.now()
  const cached = await readCache(db)
  if (cached && now - cached.checkedAt < UPDATE_CACHE_TTL_MS) {
    return responseFrom(cached, true)
  }

  if (!(await acquireLease(db, now))) {
    const current = (await readCache(db)) ?? cached
    return current
      ? responseFrom(current, true)
      : responseFrom({ latestVersion: null, checkedAt: now, status: 'unavailable' }, true)
  }

  try {
    const fetched = await fetchRepositoryVersion(
      options.fetcher ?? fetch,
      options.timeoutMs ?? UPDATE_FETCH_TIMEOUT_MS,
    )

    if (fetched.kind === 'version') {
      const next: CachedVersion = {
        latestVersion: fetched.version,
        checkedAt: now,
        status: 'ok',
      }
      await writeCache(db, next)
      return responseFrom(next, false)
    }

    const fallback: CachedVersion = cached?.latestVersion
      ? { ...cached, checkedAt: now, status: 'stale' }
      : { latestVersion: null, checkedAt: now, status: 'unavailable' }
    await writeCache(db, fallback)
    return responseFrom(fallback, false)
  } catch {
    const fallback: CachedVersion = cached?.latestVersion
      ? { ...cached, checkedAt: now, status: 'stale' }
      : { latestVersion: null, checkedAt: now, status: 'unavailable' }
    await writeCache(db, fallback)
    return responseFrom(fallback, false)
  }
}

async function fetchRepositoryVersion(
  fetcher: Fetcher,
  timeoutMs: number,
): Promise<{ kind: 'version'; version: string } | { kind: 'failure' }> {
  let response: Response
  try {
    response = await fetcher(GITHUB_PACKAGE_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': `Inkstone/${APP_VERSION}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { kind: 'failure' }
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    return { kind: 'failure' }
  }

  const declaredLength = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PACKAGE_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {})
    return { kind: 'failure' }
  }

  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_PACKAGE_RESPONSE_BYTES) {
    return { kind: 'failure' }
  }

  try {
    const body = JSON.parse(text) as { version?: unknown }
    return isValidVersion(body.version)
      ? { kind: 'version', version: body.version }
      : { kind: 'failure' }
  } catch {
    return { kind: 'failure' }
  }
}

async function readCache(db: D1Database): Promise<CachedVersion | null> {
  const row = await db
    .prepare(`SELECT value FROM app_meta WHERE key = ?1`)
    .bind(CACHE_KEY)
    .first<{ value: string }>()
  if (!row) return null

  try {
    const value = JSON.parse(row.value) as Partial<CachedVersion>
    const latestVersion = value.latestVersion ?? null
    if (
      !Number.isSafeInteger(value.checkedAt) ||
      (value.checkedAt ?? -1) < 0 ||
      !isCacheStatus(value.status) ||
      !isValidCachedResult(value.status, latestVersion)
    ) {
      return null
    }
    return {
      latestVersion,
      checkedAt: value.checkedAt!,
      status: value.status!,
    }
  } catch {
    return null
  }
}

async function writeCache(db: D1Database, value: CachedVersion): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(CACHE_KEY, JSON.stringify(value))
    .run()
}

async function acquireLease(db: D1Database, now: number): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE CAST(app_meta.value AS INTEGER) < ?3`,
    )
    .bind(LEASE_KEY, String(now + UPDATE_CHECK_LEASE_MS), now)
    .run()
  return (result.meta.changes ?? 0) > 0
}

function responseFrom(value: CachedVersion, cached: boolean): UpdateCheckResponse {
  return {
    currentVersion: APP_VERSION,
    latestVersion: value.latestVersion,
    updateUrl: value.latestVersion ? GITHUB_REPOSITORY_URL : null,
    checkedAt: value.checkedAt,
    status: value.status,
    cached,
  }
}

function isCacheStatus(value: unknown): value is UpdateCheckStatus {
  return value === 'ok' || value === 'stale' || value === 'unavailable'
}

function isValidCachedResult(status: UpdateCheckStatus, version: unknown): version is string | null {
  return status === 'unavailable' ? version === null : isValidVersion(version)
}
