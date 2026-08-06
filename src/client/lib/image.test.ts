import { describe, expect, it } from 'vitest'
import { imageNeedsOptimization, optimizeImageFile } from './image'

const KIB = 1024
const MIB = 1024 * KIB

describe('imageNeedsOptimization', () => {
  it('never optimizes non-image or animated formats', () => {
    expect(imageNeedsOptimization('text/plain', 5 * MIB, 4000, 3000)).toBe(false)
    expect(imageNeedsOptimization('image/gif', 5 * MIB, 4000, 3000)).toBe(false)
    expect(imageNeedsOptimization('image/svg+xml', 5 * MIB, 4000, 3000)).toBe(false)
  })

  it('skips small files regardless of dimensions', () => {
    expect(imageNeedsOptimization('image/png', 500 * KIB, 5000, 4000)).toBe(false)
    expect(imageNeedsOptimization('image/jpeg', MIB, 3000, 2000)).toBe(false)
  })

  it('optimizes files above the hard byte ceiling', () => {
    expect(imageNeedsOptimization('image/jpeg', 2 * MIB + 1, 800, 600)).toBe(true)
    expect(imageNeedsOptimization('image/png', 10 * MIB, 640, 480)).toBe(true)
  })

  it('optimizes mid-size files whose longest edge is too large', () => {
    expect(imageNeedsOptimization('image/webp', 1.5 * MIB, 5000, 3000)).toBe(true)
  })

  it('keeps mid-size files with reasonable dimensions', () => {
    expect(imageNeedsOptimization('image/png', 1.5 * MIB, 1800, 1200)).toBe(false)
    expect(imageNeedsOptimization('image/jpeg', 1.5 * MIB, 2048, 2048)).toBe(false)
  })
})

describe('optimizeImageFile', () => {
  it('falls back to the original file when image decoding is unavailable', async () => {
    const file = new File(['not-an-image'], 'screenshot.png', { type: 'image/png' })
    const result = await optimizeImageFile(file)
    expect(result).toBe(file)
  })

  it('passes through non-image files untouched', async () => {
    const file = new File(['plain text'], 'notes.txt', { type: 'text/plain' })
    const result = await optimizeImageFile(file)
    expect(result).toBe(file)
  })
})
