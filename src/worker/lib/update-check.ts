import {
  APP_VERSION,
  GITHUB_PACKAGE_URL,
  GITHUB_REPOSITORY_URL,
} from '@shared/constants'
import type { UpdateCheckResponse } from '@shared/types'
import { isValidVersion } from '@shared/version'

const UPDATE_FETCH_TIMEOUT_MS = 5_000
const MAX_PACKAGE_RESPONSE_BYTES = 64 * 1024

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type FetchResult =
  | { kind: 'version'; version: string }
  | { kind: 'failure'; reason: string; status?: number; detail?: string }

export async function checkRepositoryVersion(
  options: {
    fetcher?: Fetcher
    now?: number
    timeoutMs?: number
  } = {},
): Promise<UpdateCheckResponse> {
  const now = options.now ?? Date.now()
  const fetched = await fetchRepositoryVersion(
    options.fetcher ?? fetch,
    options.timeoutMs ?? UPDATE_FETCH_TIMEOUT_MS,
  )
  const latestVersion = fetched.kind === 'version' ? fetched.version : null
  if (fetched.kind === 'failure') {
    console.warn('Repository version check failed', {
      reason: fetched.reason,
      ...(fetched.status === undefined ? {} : { status: fetched.status }),
      ...(fetched.detail === undefined ? {} : { detail: fetched.detail }),
    })
  }

  return {
    currentVersion: APP_VERSION,
    latestVersion,
    updateUrl: latestVersion ? GITHUB_REPOSITORY_URL : null,
    checkedAt: now,
    status: latestVersion ? 'ok' : 'unavailable',
  }
}

async function fetchRepositoryVersion(
  fetcher: Fetcher,
  timeoutMs: number,
): Promise<FetchResult> {
  let response: Response
  try {
    response = await fetcher(GITHUB_PACKAGE_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return {
      kind: 'failure',
      reason: error instanceof Error && error.name === 'TimeoutError'
        ? 'timeout'
        : 'fetch_error',
      detail: error instanceof Error
        ? `${error.name}: ${error.message}`.slice(0, 240)
        : typeof error,
    }
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    return { kind: 'failure', reason: 'http_error', status: response.status }
  }

  const declaredLength = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PACKAGE_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {})
    return { kind: 'failure', reason: 'response_too_large' }
  }

  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_PACKAGE_RESPONSE_BYTES) {
    return { kind: 'failure', reason: 'response_too_large' }
  }

  try {
    const body = JSON.parse(text) as { version?: unknown }
    return isValidVersion(body.version)
      ? { kind: 'version', version: body.version }
      : { kind: 'failure', reason: 'invalid_version' }
  } catch {
    return { kind: 'failure', reason: 'invalid_json' }
  }
}
