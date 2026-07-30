import { AwsClient } from 'aws4fetch'
import { truncateText } from '@shared/text-utils'
import type { S3Config, TestConnectionResult } from '@shared/types'
import type { BackupFile } from './snapshot'
import {
  BACKUP_USER_AGENT,
  friendlyError,
  readResponseBytesWithinLimit,
  type DeliverResult,
} from './common'
import { forEachConcurrent } from './concurrency'
import {
  normalizeBackupPrefix,
  normalizeS3Region,
  parseBackupEndpoint,
  validateS3Bucket,
} from './validation'

export interface S3Secret {
  accessKeyId?: string
  secretAccessKey?: string
}

function client(secret: S3Secret, config: S3Config): AwsClient {
  if (!secret.accessKeyId || !secret.secretAccessKey) {
    throw new Error('Access Key or Secret Key is missing')
  }
  return new AwsClient({
    accessKeyId: secret.accessKeyId,
    secretAccessKey: secret.secretAccessKey,
    region: normalizeS3Region(config.region),
    service: 's3',
  })
}


export function objectUrl(config: S3Config, key: string): string {
  const region = normalizeS3Region(config.region)
  const raw = config.endpoint?.trim() || `https://s3.${region === 'auto' ? 'us-east-1' : region}.amazonaws.com`
  const endpoint = parseBackupEndpoint(raw, 'Endpoint')
  const bucket = validateS3Bucket(config.bucket ?? '', config.pathStyle === true)
  const encodedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  if (config.pathStyle) {
    const prefix = endpoint.pathname.replace(/\/+$/, '')
    return `${endpoint.origin}${prefix}/${encodeURIComponent(bucket)}/${encodedKey}`
  }
  const prefix = endpoint.pathname.replace(/\/+$/, '')
  return `${endpoint.protocol}//${bucket}.${endpoint.host}${prefix}/${encodedKey}`
}

function joinKey(...parts: (string | undefined)[]): string {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

export async function s3Deliver(
  config: S3Config,
  secret: S3Secret,
  files: BackupFile[],
  rootDir: string,
  signal?: AbortSignal,
): Promise<DeliverResult> {
  const aws = client(secret, config)
  let bytes = 0
  let count = 0

  await forEachConcurrent(files, 4, async (file) => {
    const key = joinKey(normalizeBackupPrefix(config.prefix ?? ''), rootDir, file.path)
    const res = await aws.fetch(objectUrl(config, key), {
      method: 'PUT',
      body: file.body as unknown as BodyInit,
      headers: { 'Content-Type': file.contentType, 'User-Agent': BACKUP_USER_AGENT },
      signal,
      redirect: 'manual',
    })
    if (!res.ok) throw new Error(await describeError(res, key))
    await res.body?.cancel().catch(() => {})
    bytes += file.body.byteLength
    count++
  })

  return { files: count, bytes }
}

export async function s3Test(
  config: S3Config,
  secret: S3Secret,
  signal?: AbortSignal,
): Promise<TestConnectionResult> {
  const started = Date.now()
  try {
    if (!config.bucket?.trim()) return { ok: false, message: 'Enter a bucket name' }
    const aws = client(secret, config)
    const key = joinKey(
      normalizeBackupPrefix(config.prefix ?? ''),
      `.inkstone-check-${crypto.randomUUID()}`,
    )
    const url = objectUrl(config, key)
    const payload = new TextEncoder().encode(`inkstone ${new Date().toISOString()}`)
    let written = false
    try {
      const put = await aws.fetch(url, {
        method: 'PUT',
        body: payload as unknown as BodyInit,
        headers: { 'Content-Type': 'text/plain', 'User-Agent': BACKUP_USER_AGENT },
        signal,
        redirect: 'manual',
      })
      if (!put.ok) return { ok: false, message: await describeError(put, key) }
      written = true
      await put.body?.cancel().catch(() => {})

      const get = await aws.fetch(url, { method: 'GET', signal, redirect: 'manual' })
      if (!get.ok) {
        return { ok: false, message: `Write succeeded but read failed: ${await describeError(get, key)}` }
      }
      const downloaded = await readResponseBytesWithinLimit(get, 1024)
      if (!bytesEqual(downloaded, payload)) {
        return { ok: false, message: 'The data read after writing did not match. Check the storage gateway or proxy' }
      }

      return {
        ok: true,
        message: 'Connection succeeded with read and write access',
        latencyMs: Date.now() - started,
      }
    } finally {
      if (written) {
        const removed = await aws.fetch(url, {
          method: 'DELETE',
          signal: AbortSignal.timeout(5_000),
          redirect: 'manual',
        })
        await removed.body?.cancel().catch(() => {})
        if (!removed.ok && removed.status !== 404) {
          throw new Error(`Read and write succeeded, but the test file could not be removed: HTTP ${removed.status}`)
        }
      }
    }
  } catch (err) {
    return { ok: false, message: friendlyError(err) }
  }
}

async function describeError(res: Response, key: string): Promise<string> {
  let detail = ''
  try {
    const text = truncateText(
      new TextDecoder().decode(await readResponseBytesWithinLimit(res, 4096)),
      800,
    )
    detail = /<Message>([\s\S]*?)<\/Message>/.exec(text)?.[1] ?? text.replace(/<[^>]+>/g, ' ').trim()
  } catch {
  }

  const hints: Record<number, string> = {
    301: 'The bucket region does not match. Check region and endpoint',
    400: 'The request was rejected. Check region and endpoint',
    403: 'The key is invalid or lacks write access to this bucket',
    404: 'The bucket does not exist or the endpoint is incorrect',
    501: 'The service does not support this operation. Enable path-style access',
  }
  const hint = hints[res.status]
  return `HTTP ${res.status}${hint ? ` · ${hint}` : ''}${detail ? ` · ${detail}` : ''} (${key})`
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  return a.every((value, index) => value === b[index])
}
