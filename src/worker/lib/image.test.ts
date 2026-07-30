import { describe, expect, it } from 'vitest'
import {
  hasExpectedImageSignature,
  hasReasonableImageDimensions,
  readImageSize,
  safeAttachmentMime,
} from './image'

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const data = new DataView(bytes.buffer)
  data.setUint32(16, width)
  data.setUint32(20, height)
  return bytes
}

describe('attachment content handling', () => {
  it('reads dimensions only from a complete PNG signature and IHDR header', () => {
    const bytes = png(1280, 720)
    expect(hasExpectedImageSignature(bytes, 'image/png')).toBe(true)
    expect(readImageSize(bytes, 'image/png')).toEqual({ width: 1280, height: 720 })

    bytes[5] = 0
    expect(hasExpectedImageSignature(bytes, 'image/png')).toBe(false)
    expect(readImageSize(bytes, 'image/png')).toBeNull()
  })

  it('downgrades spoofed images and unknown active types to forced downloads', () => {
    const html = new TextEncoder().encode('<script>alert(1)</script>')
    expect(safeAttachmentMime(html, 'image/png')).toBe('application/octet-stream')
    expect(safeAttachmentMime(html, 'text/html')).toBe('application/octet-stream')
    expect(safeAttachmentMime(html, 'text/plain; charset=utf-8')).toBe('text/plain')
  })

  it('keeps valid raster images inline but rejects pathological decoded dimensions', () => {
    const bytes = png(32, 16)
    expect(safeAttachmentMime(bytes, 'IMAGE/PNG')).toBe('image/png')
    expect(hasReasonableImageDimensions({ width: 10_000, height: 10_000 })).toBe(true)
    expect(hasReasonableImageDimensions({ width: 10_001, height: 10_000 })).toBe(false)
    expect(hasReasonableImageDimensions({ width: 0, height: 10 })).toBe(false)
  })
})
