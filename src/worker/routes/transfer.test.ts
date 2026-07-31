import { describe, expect, it } from 'vitest'
import { ApiError } from '../lib/errors'
import { importedBundleTitle, importedMarkdownTitle, parseImportConflict } from './transfer'

describe('imported note titles', () => {
  it('preserves an explicitly empty title from a backup', () => {
    expect(importedBundleTitle('', '# Body heading')).toBe('')
  })

  it('preserves and normalizes a custom title from a backup', () => {
    expect(importedBundleTitle('  Custom title  ', '# Body heading')).toBe('Custom title')
  })

  it('derives a title only for legacy backups that omitted it', () => {
    expect(importedBundleTitle(undefined, '# Legacy heading')).toBe('Legacy heading')
  })

  it('preserves an explicitly empty Markdown front matter title', () => {
    expect(importedMarkdownTitle({ title: '' }, '# Body heading', 'filename')).toBe('')
  })

  it('derives a Markdown title only when front matter omitted it', () => {
    expect(importedMarkdownTitle({}, '# Body heading', 'filename')).toBe('Body heading')
  })
})

describe('import conflict validation', () => {
  it('defaults only an omitted field to newer', () => {
    expect(parseImportConflict(null)).toBe('newer')
    expect(parseImportConflict(undefined)).toBe('newer')
  })

  it.each(['skip', 'newer', 'duplicate'] as const)('accepts %s', (value) => {
    expect(parseImportConflict(value)).toBe(value)
  })

  it('rejects an unknown strategy instead of silently allowing updates', () => {
    expect(() => parseImportConflict('overwrite')).toThrowError(ApiError)
    expect(() => parseImportConflict('')).toThrow('conflict must be skip, newer, or duplicate')
  })
})
