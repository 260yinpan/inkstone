import { describe, expect, it } from 'vitest'
import { htmlToMarkdown, uploadedFileMarkdown } from './paste'

describe('rich text paste conversion', () => {
  it('keeps top-level and nested lists at their real Markdown depth', () => {
    expect(htmlToMarkdown(
      '<ul><li>Parent<ul><li>Child</li></ul></li><li>Sibling</li></ul>',
    )).toBe('- Parent\n  - Child\n- Sibling')

    expect(htmlToMarkdown(
      '<ol start="3"><li>Third<ol><li>Nested</li></ol></li></ol>',
    )).toBe('3. Third\n   1. Nested')
  })

  it('escapes link labels and discards executable or ephemeral destinations', () => {
    expect(htmlToMarkdown(
      '<p><a href="https://example.com/a b">a]b</a> ' +
      '<a href="JAVASCRIPT:alert(1)">unsafe</a>' +
      '<img src="data:image/png;base64,AA" alt="inline"></p>',
    )).toBe('[a\\]b](<https://example.com/a%20b>) unsafe')
    expect(htmlToMarkdown(
      '<a href="https://example.com"><strong>Bold</strong> and <em>italic</em></a>',
    )).toBe('[**Bold** and *italic*](<https://example.com>)')
  })

  it('chooses code delimiters that cannot close pasted code early', () => {
    expect(htmlToMarkdown('<p><code>a`b</code></p>')).toBe('``a`b``')
    expect(htmlToMarkdown('<pre><code>before\n```\nafter</code></pre>')).toBe(
      '````\nbefore\n```\nafter\n````',
    )
  })

  it('keeps dotfile image names visible', () => {
    expect(uploadedFileMarkdown({
      url: '/api/files/dotfile',
      filename: '.image',
      isImage: true,
    })).toBe('![.image](</api/files/dotfile>)')
  })
})
