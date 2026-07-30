import { describe, expect, it } from 'vitest'
import { extractAttachmentIds, extractTags, parseFrontMatter, sortTagNames } from './markdown-utils'

describe('front matter safety limit', () => {
  it('counts UTF-8 bytes instead of JavaScript characters', () => {
    const source = `---\ntitle: ${'\u4e2d'.repeat(22_000)}\n---\nBody`
    const parsed = parseFrontMatter(source)
    expect(parsed.errors).toContain('Front Matter exceeds the 64 KiB safety limit')
    expect(parsed.body).toBe(source)
  })

  it('keeps ordinary front matter within the limit', () => {
    const parsed = parseFrontMatter('---\ntitle: \u6d4b\u8bd5\n---\nBody')
    expect(parsed.errors).toEqual([])
    expect(parsed.data).toEqual({ title: '\u6d4b\u8bd5' })
    expect(parsed.body).toBe('Body')
  })
})

describe('stable tag ordering', () => {
  it('uses the same canonical order regardless of source or database aggregation order', () => {
    const expected = sortTagNames(['zeta', 'alpha', '\u9879\u76ee2', '\u9879\u76ee10'])
    expect(extractTags('\u6b63\u6587 #zeta #alpha #\u9879\u76ee2 #\u9879\u76ee10')).toEqual(expected)
    expect(sortTagNames(['\u9879\u76ee10', 'zeta', '\u9879\u76ee2', 'alpha'])).toEqual(expected)
    expect(expected.indexOf('\u9879\u76ee2')).toBeLessThan(expected.indexOf('\u9879\u76ee10'))
  })

  it('does not extract a misleading prefix from an overlong tag', () => {
    const overlong = `#${'a'.repeat(61)}`
    expect(extractTags(`before ${overlong} after #valid`)).toEqual(['valid'])
  })
})

describe('attachment references', () => {
  const first = '01k1234567abcdefghjkmnpqrs'
  const second = '01k7654321stvwxyz012345678'

  it('extracts exact relative Markdown and HTML attachment URLs once', () => {
    expect(extractAttachmentIds([
      `![image](</api/files/${first}>)`,
      `[download](/api/files/${second}?download=1)`,
      `<img src=/api/files/${first}>`,
    ].join('\n'))).toEqual([first, second])
  })

  it('ignores metadata, code and attachment-id prefixes', () => {
    expect(extractAttachmentIds([
      '---',
      `example: /api/files/${first}`,
      '---',
      `\`/api/files/${first}\``,
      '```md',
      `![example](/api/files/${first})`,
      '```',
      `/api/files/${second}extra`,
    ].join('\n'))).toEqual([])
  })
})
