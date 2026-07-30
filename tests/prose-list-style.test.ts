import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('preview list marker styles', () => {
  it('restores ordered and unordered markers after the Tailwind reset', () => {
    const css = readFileSync(resolve('src/client/styles/prose.css'), 'utf8')

    expect(css).toMatch(/\.ink-prose ul\s*\{[^}]*list-style-type:\s*disc/s)
    expect(css).toMatch(/\.ink-prose ol\s*\{[^}]*list-style-type:\s*decimal/s)
    expect(css).toMatch(/\.ink-prose ul ul\s*\{[^}]*list-style-type:\s*circle/s)
    expect(css).toMatch(/\.ink-prose ul ul ul\s*\{[^}]*list-style-type:\s*square/s)
  })
})
