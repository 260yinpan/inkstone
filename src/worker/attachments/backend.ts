import type { Env } from '../env'
import type { AttachmentObjectStorage } from './keys'

export interface AttachmentObjectMetadata {
  userId: string
  objectId: string
  kind: 'attachment' | 'avatar'
  filename: string
  mime: string
  sha256: string
}

export function selectAttachmentStorage(env: Env): AttachmentObjectStorage | null {
  if (env.FILES) return 'r2'
  if (env.FILES_KV) return 'kv'
  return null
}

export function isAttachmentObjectStorage(value: string): value is AttachmentObjectStorage {
  return value === 'r2' || value === 'kv'
}

export function hasAttachmentStorage(env: Env, storage: AttachmentObjectStorage): boolean {
  return storage === 'r2' ? Boolean(env.FILES) : Boolean(env.FILES_KV)
}

export async function putAttachmentObject(
  env: Env,
  storage: AttachmentObjectStorage,
  key: string,
  bytes: Uint8Array,
  metadata: AttachmentObjectMetadata,
): Promise<void> {
  if (storage === 'r2') {
    if (!env.FILES) throw new Error('R2 attachment storage is not configured')
    await env.FILES.put(key, bytes, {
      httpMetadata: { contentType: metadata.mime, cacheControl: 'private, no-store' },
      customMetadata: {
        userId: metadata.userId,
        objectId: metadata.objectId,
        kind: metadata.kind,
        sha256: metadata.sha256,
      },
    })
    return
  }

  if (!env.FILES_KV) throw new Error('KV attachment storage is not configured')
  await env.FILES_KV.put(key, bytes, {
    metadata: {
      userId: metadata.userId,
      objectId: metadata.objectId,
      kind: metadata.kind,
      filename: metadata.filename,
      mime: metadata.mime,
      sha256: metadata.sha256,
    },
  })
}

export async function readAttachmentObject(
  env: Env,
  storage: AttachmentObjectStorage,
  key: string,
): Promise<Uint8Array | null> {
  if (storage === 'r2') {
    if (!env.FILES) throw new Error('R2 attachment storage is not configured')
    const object = await env.FILES.get(key)
    return object ? new Uint8Array(await object.arrayBuffer()) : null
  }

  if (!env.FILES_KV) throw new Error('KV attachment storage is not configured')
  const value = await env.FILES_KV.get(key, 'arrayBuffer')
  return value ? new Uint8Array(value) : null
}

export async function deleteAttachmentObjects(
  env: Env,
  storage: AttachmentObjectStorage,
  keys: readonly string[],
): Promise<void> {
  if (!keys.length) return
  if (storage === 'r2') {
    if (!env.FILES) throw new Error('R2 attachment storage is not configured')
    await env.FILES.delete([...keys])
    return
  }

  if (!env.FILES_KV) throw new Error('KV attachment storage is not configured')
  for (let offset = 0; offset < keys.length; offset += 25) {
    await Promise.all(keys.slice(offset, offset + 25).map((key) => env.FILES_KV!.delete(key)))
  }
}
