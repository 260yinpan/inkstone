import { describe, expect, it } from 'vitest'
import { publicShareTitle } from './share'

describe('publicShareTitle', () => {
  it('keeps a custom title', () => {
    expect(publicShareTitle('Release notes')).toBe('Release notes')
  })

  it('gives intentionally untitled shares a meaningful metadata title', () => {
    expect(publicShareTitle('')).toBe('Untitled note')
  })
})
