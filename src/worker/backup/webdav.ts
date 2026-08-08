import type { TestConnectionResult, WebdavConfig } from '@shared/types'
import type { BackupFile } from './snapshot'
import {
  BACKUP_USER_AGENT,
  friendlyError,
  readResponseBytesWithinLimit,
  type DeliverResult,
} from './common'
import { forEachConcurrent } from './concurrency'
import { normalizeBackupPrefix, parseBackupEndpoint } from './validation'

export interface WebdavSecret {
  password?: string
}

function authHeader(config: WebdavConfig, secret: WebdavSecret): string {
  if (!config.username?.trim() || !secret.password?.trim()) {
    throw new Error('WebDAV username or password is missing')
  }
  const raw = `${config.username ?? ''}:${secret.password ?? ''}`
  const bytes = new TextEncoder().encode(raw)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `Basic ${btoa(bin)}`
}

function baseUrl(config: WebdavConfig): URL {
  const raw = (config.url ?? '').trim()
  if (!raw) throw new Error('Enter a WebDAV URL')
  const url = parseBackupEndpoint(raw, "WebDAV address")
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function childUrl(base: URL, relative: string): string {
  const segments = relative
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
  return new URL(base.pathname + segments.join('/'), base.origin).toString()
}

const WEBDAV_REDIRECTS = new Set([301, 302, 307, 308])
const MAX_WEBDAV_REDIRECTS = 4

async function webdavFetch(
  input: string | URL,
  init: RequestInit,
  trustedOrigin: string,
): Promise<Response> {
  let current = new URL(input)

  for (let redirects = 0; redirects <= MAX_WEBDAV_REDIRECTS; redirects++) {
    const response = await fetch(current, { ...init, redirect: 'manual' })
    if (!WEBDAV_REDIRECTS.has(response.status)) return response

    const location = response.headers.get('Location')
    if (!location) return response
    if (redirects === MAX_WEBDAV_REDIRECTS) {
      await response.body?.cancel().catch(() => {})
      throw new Error('Too many WebDAV redirects')
    }

    const next = new URL(location, current)
    if (
      next.protocol !== 'https:' ||
      next.origin !== trustedOrigin ||
      next.username ||
      next.password
    ) {
      await response.body?.cancel().catch(() => {})
      throw new Error('WebDAV redirected to another origin. Enter the final HTTPS URL to protect credentials')
    }

    await response.body?.cancel().catch(() => {})
    current = next
  }

  throw new Error('Too many WebDAV redirects')
}

async function ensureDirs(
  base: URL,
  auth: string,
  dirs: string[],
  created: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  for (const dir of dirs) {
    const parts = dir.split('/').filter(Boolean)
    let path = ''
    for (const part of parts) {
      path = path ? `${path}/${part}` : part
      if (created.has(path)) continue
      const res = await webdavFetch(childUrl(base, path), {
        method: 'MKCOL',
        headers: { Authorization: auth, 'User-Agent': BACKUP_USER_AGENT },
        signal,
      }, base.origin)
      await res.body?.cancel().catch(() => {})
      if (!res.ok && res.status !== 405) {
        if (res.status === 401) throw new Error("Incorrect username or password")
        if (res.status === 403) throw new Error('Permission to create folders is missing')
        if (res.status === 409) throw new Error(`Creating folder ${path} failed because the parent folder does not exist`)
        if (res.status === 507) throw new Error('The server is out of storage')
        throw new Error(`Creating folder ${path} failed: HTTP ${res.status}`)
      }
      created.add(path)
    }
  }
}

export async function webdavDeliver(
  config: WebdavConfig,
  secret: WebdavSecret,
  files: BackupFile[],
  rootDir: string,
  signal?: AbortSignal,
): Promise<DeliverResult> {
  const base = baseUrl(config)
  const auth = authHeader(config, secret)
  const prefix = normalizeBackupPrefix(config.prefix ?? '')

  const created = new Set<string>()
  const dirs = new Set<string>()
  for (const file of files) {
    const full = [prefix, rootDir, file.path].filter(Boolean).join('/')
    const dir = full.slice(0, full.lastIndexOf('/'))
    if (dir) dirs.add(dir)
  }
  await ensureDirs(base, auth, [...dirs].sort(), created, signal)

  let bytes = 0
  let count = 0

  await forEachConcurrent(files, 3, async (file) => {
    const target = [prefix, rootDir, file.path].filter(Boolean).join('/')
    const res = await webdavFetch(childUrl(base, target), {
      method: 'PUT',
      headers: {
        Authorization: auth,
        'Content-Type': file.contentType,
        Overwrite: 'T',
        'User-Agent': BACKUP_USER_AGENT,
      },
      body: file.body as unknown as BodyInit,
      signal,
    }, base.origin)
    await res.body?.cancel().catch(() => {})
    if (!res.ok) {
      if (res.status === 401) throw new Error("Incorrect username or password")
      if (res.status === 403) throw new Error('Write access is missing')
      if (res.status === 404) throw new Error(`Path not found: ${target}`)
      if (res.status === 507) throw new Error('The server is out of storage')
      throw new Error(`Upload ${file.path} failed: HTTP ${res.status}`)
    }
    bytes += file.body.byteLength
    count++
  })

  return { files: count, bytes }
}

export async function webdavTest(
  config: WebdavConfig,
  secret: WebdavSecret,
  signal?: AbortSignal,
): Promise<TestConnectionResult> {
  const started = Date.now()
  try {
    const base = baseUrl(config)
    const auth = authHeader(config, secret)

    const probe = await webdavFetch(base.toString(), {
      method: 'PROPFIND',
      headers: { Authorization: auth, Depth: '0', 'Content-Type': 'application/xml', 'User-Agent': BACKUP_USER_AGENT },
      signal,
    }, base.origin)
    await probe.body?.cancel().catch(() => {})
    if (probe.status === 401) return { ok: false, message: "Incorrect username or password" }
    if (probe.status === 404) return { ok: false, message: 'The path does not exist. Check the URL' }
    if (!probe.ok && probe.status !== 207 && probe.status !== 405) {
      return { ok: false, message: `Server returned HTTP ${probe.status}` }
    }

    const prefix = normalizeBackupPrefix(config.prefix ?? '')
    if (prefix) await ensureDirs(base, auth, [prefix], new Set(), signal)

    const checkPath = [prefix, `.inkstone-check-${crypto.randomUUID()}`].filter(Boolean).join('/')
    const checkUrl = childUrl(base, checkPath)
    const payload = new TextEncoder().encode(`inkstone ${new Date().toISOString()}`)
    let written = false
    let readWriteSucceeded = false
    let primaryFailure: TestConnectionResult | null = null
    try {
      const put = await webdavFetch(checkUrl, {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'text/plain', Overwrite: 'T', 'User-Agent': BACKUP_USER_AGENT },
        body: payload as unknown as BodyInit,
        signal,
      }, base.origin)
      await put.body?.cancel().catch(() => {})
      if (!put.ok) {
        if (put.status === 403) return { ok: false, message: 'Connected, but write access is missing' }
        if (put.status === 507) return { ok: false, message: 'The server is out of storage' }
        return { ok: false, message: `Write test failed: HTTP ${put.status}` }
      }
      written = true

      const get = await webdavFetch(checkUrl, {
        method: 'GET',
        headers: { Authorization: auth, 'User-Agent': BACKUP_USER_AGENT },
        signal,
      }, base.origin)
      if (!get.ok) {
        await get.body?.cancel().catch(() => {})
        primaryFailure = { ok: false, message: `Write succeeded but read failed: HTTP ${get.status}` }
        return primaryFailure
      }
      const downloaded = await readResponseBytesWithinLimit(get, 1024)
      if (!bytesEqual(downloaded, payload)) {
        primaryFailure = { ok: false, message: 'The data read after writing did not match. Check the WebDAV gateway or proxy' }
        return primaryFailure
      }

      readWriteSucceeded = true
      return { ok: true, message: 'Connection succeeded with read and write access', latencyMs: Date.now() - started }
    } finally {
      if (written) {
        let cleanupError: Error | null = null
        try {
          const removed = await webdavFetch(checkUrl, {
            method: 'DELETE',
            headers: { Authorization: auth, 'User-Agent': BACKUP_USER_AGENT },
            signal: AbortSignal.timeout(5_000),
          }, base.origin)
          await removed.body?.cancel().catch(() => {})
          if (!removed.ok && removed.status !== 404) {
            cleanupError = new Error(`The test file could not be removed: HTTP ${removed.status}`)
          }
        } catch (error) {
          cleanupError = new Error(`The test file could not be removed: ${friendlyError(error)}`)
        }
        if (cleanupError) {
          if (readWriteSucceeded) throw cleanupError
          if (primaryFailure) primaryFailure.message += `. ${cleanupError.message}`
          console.warn('[inkstone] WebDAV test file cleanup failed:', cleanupError.message)
        }
      }
    }
  } catch (err) {
    return { ok: false, message: friendlyError(err) }
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  return a.every((value, index) => value === b[index])
}
