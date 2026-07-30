import { createAvatar } from '@dicebear/core'
import * as micah from '@dicebear/micah'
import {
  AVATAR_SOURCE_FILE_MAX_BYTES,
  AVATAR_STORED_MAX_BYTES,
  GENERATED_AVATAR_SEED_LENGTH,
  generatedAvatarPreference,
  generatedAvatarSeed,
  isBitmapAvatarDataUrl,
  parseStoredAvatarUrl,
} from '@shared/avatar'

const BACKGROUND_COLORS = ['f87171', 'fb923c', '09acf4', 'fb923c', 'f472b6', 'a78bfa', '34d399']
const BASE_COLORS = ['f7e1c3', 'f9c9b6', 'f2d6cb', 'f8ce8e', 'eac393']
const avatarCache = new Map<string, string>()
const AVATAR_CACHE_LIMIT = 160

export type AvatarUploadErrorCode =
  | 'unsupported'
  | 'too_large'
  | 'decode_failed'
  | 'encode_failed'

export class AvatarUploadError extends Error {
  constructor(readonly code: AvatarUploadErrorCode) {
    super(code)
    this.name = 'AvatarUploadError'
  }
}

export function avatarBackgroundColor(seed: string): string {
  let hash = 0
  for (let index = 0; index < seed.length; index++) {
    hash = seed.charCodeAt(index) + ((hash << 5) - hash)
  }
  return BACKGROUND_COLORS[Math.abs(hash) % BACKGROUND_COLORS.length]!
}

export function createAvatarDataUri(seed: string): string {
  const normalizedSeed = seed.trim() || '?'
  const cached = avatarCache.get(normalizedSeed)
  if (cached) return cached

  const uri = createAvatar(micah, {
    seed: normalizedSeed,
    baseColor: BASE_COLORS,
    backgroundColor: [avatarBackgroundColor(normalizedSeed)],
  }).toDataUri()

  if (avatarCache.size >= AVATAR_CACHE_LIMIT) {
    const oldest = avatarCache.keys().next().value as string | undefined
    if (oldest) avatarCache.delete(oldest)
  }
  avatarCache.set(normalizedSeed, uri)
  return uri
}

export function resolveAvatarSource(
  preference: string | null | undefined,
  displayName: string,
): string {
  if (isBitmapAvatarDataUrl(preference)) return preference!
  if (parseStoredAvatarUrl(preference)) return preference!
  return createAvatarDataUri(generatedAvatarSeed(preference) ?? displayName)
}

export function createRandomAvatarPreferences(count = 5): string[] {
  const result = new Set<string>()
  while (result.size < count) {
    const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_AVATAR_SEED_LENGTH / 2))
    const seed = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
    result.add(generatedAvatarPreference(seed))
  }
  return [...result]
}

export async function prepareAvatarUpload(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new AvatarUploadError('unsupported')
  }
  if (!file.size || file.size > AVATAR_SOURCE_FILE_MAX_BYTES) {
    throw new AvatarUploadError('too_large')
  }

  const image = await loadImage(file)
  if (
    image.naturalWidth > 16_384 ||
    image.naturalHeight > 16_384 ||
    image.naturalWidth * image.naturalHeight > 64 * 1024 * 1024
  ) {
    throw new AvatarUploadError('too_large')
  }
  const attempts: Array<{ size: number; mime: 'image/webp' | 'image/jpeg'; quality: number }> = [
    { size: 256, mime: 'image/webp', quality: 0.86 },
    { size: 224, mime: 'image/webp', quality: 0.78 },
    { size: 192, mime: 'image/jpeg', quality: 0.78 },
  ]

  for (const attempt of attempts) {
    const blob = await renderSquare(image, attempt.size, attempt.mime, attempt.quality)
    if (blob && blob.size > 0 && blob.size <= AVATAR_STORED_MAX_BYTES) {
      return blobToDataUrl(blob)
    }
  }
  throw new AvatarUploadError('encode_failed')
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      if (!image.naturalWidth || !image.naturalHeight) reject(new AvatarUploadError('decode_failed'))
      else resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new AvatarUploadError('decode_failed'))
    }
    image.src = objectUrl
  })
}

function renderSquare(
  image: HTMLImageElement,
  size: number,
  mime: 'image/webp' | 'image/jpeg',
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new AvatarUploadError('encode_failed')

  if (mime === 'image/jpeg') {
    context.fillStyle = '#f4f1eb'
    context.fillRect(0, 0, size, size)
  }
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight)
  const sourceX = (image.naturalWidth - sourceSize) / 2
  const sourceY = (image.naturalHeight - sourceSize) / 2
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    size,
    size,
  )

  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new AvatarUploadError('encode_failed'))
    }
    reader.onerror = () => reject(new AvatarUploadError('encode_failed'))
    reader.readAsDataURL(blob)
  })
}
