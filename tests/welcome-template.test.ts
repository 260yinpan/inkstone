import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveNoteEmbeds } from '../src/client/lib/markdown/embeds'
import { renderMarkdown } from '../src/client/lib/markdown/renderer'
import { welcomeNoteContent, welcomeNoteTemplates } from '../src/shared/welcome-notes'

interface TemplateCase {
  locale: 'zh-CN' | 'en-US'
  heading: string
  nextHeading: string
  embeddedText: string
  inline: string[]
  sourceFragments: string[]
}

const CASES: TemplateCase[] = [
  {
    locale: 'zh-CN',
    heading: '## Markdown \u901f\u67e5',
    nextHeading: '## \u4fdd\u5b58\u3001\u540c\u6b65\u4e0e\u6062\u590d',
    embeddedText: '\u8fd9\u6bb5\u5185\u5bb9\u4f1a\u5728\u4e0b\u65b9\u88ab\u518d\u6b21\u5d4c\u5165\u3002',
    inline: ['\u7c97\u4f53', '\u659c\u4f53', '\u5220\u9664\u7ebf', '\u9ad8\u4eae', '\u63d2\u5165\u6587\u672c', '\u884c\u5185\u4ee3\u7801', 'H2O', 'x2'],
    sourceFragments: [
      '**\u7c97\u4f53**',
      '*\u659c\u4f53*',
      '~~\u5220\u9664\u7ebf~~',
      '==\u9ad8\u4eae==',
      '++\u63d2\u5165\u6587\u672c++',
      '`\u884c\u5185\u4ee3\u7801`',
      'H~2~O',
      'x^2^',
      '[\u6253\u5f00\u793a\u4f8b\u7f51\u7ad9](https://example.com)',
      '![Inkstone \u9879\u76ee Logo](/inkstone-logo.svg "Inkstone \u9879\u76ee Logo")',
      '[[\u6211\u7684\u7b2c\u4e00\u7bc7\u7b14\u8bb0|\u6253\u5f00\u6216\u521b\u5efa\u7b14\u8bb0]]',
      '\u8fd9\u662f\u4e00\u6bb5\u53ef\u4ee5\u88ab\u7cbe\u786e\u5b9a\u4f4d\u7684\u5185\u5bb9\u3002 ^markdown-demo',
      '((markdown-demo))',
      '![[#^markdown-embed-demo]]',
      '[^markdown-footnote]: \u8fd9\u662f\u811a\u6ce8\u7684\u5b9e\u9645\u5185\u5bb9\uff1b\u70b9\u51fb\u7f16\u53f7\u53ef\u4ee5\u5728\u6b63\u6587\u4e0e\u811a\u6ce8\u4e4b\u95f4\u8df3\u8f6c\u3002',
      '$E = mc^2$',
      '$$\na^2 + b^2 = c^2\n$$',
      '```mermaid',
      '{#markdown-custom-heading .wide}',
      '> [!NOTE] Callout \u5b9e\u9645\u6548\u679c',
      '::: tabs',
      '::: details [\u70b9\u51fb\u5c55\u5f00 Markdown \u6298\u53e0\u5757]',
      '<details>',
      '```ts title="hello.ts" line-numbers {2}',
    ],
  },
  {
    locale: 'en-US',
    heading: '## Markdown quick reference',
    nextHeading: '## Saving, syncing, and recovery',
    embeddedText: 'This content is embedded again below.',
    inline: ['Bold', 'Italic', 'Strikethrough', 'Highlight', 'Inserted text', 'Inline code', 'H2O', 'x2'],
    sourceFragments: [
      '**Bold**',
      '*Italic*',
      '~~Strikethrough~~',
      '==Highlight==',
      '++Inserted text++',
      '`Inline code`',
      'H~2~O',
      'x^2^',
      '[Open the example site](https://example.com)',
      '![Inkstone project logo](/inkstone-logo.svg "Inkstone project logo")',
      '[[My first note|Open or create a note]]',
      'This content can be addressed precisely. ^markdown-demo',
      '((markdown-demo))',
      '![[#^markdown-embed-demo]]',
      '[^markdown-footnote]: This is the rendered footnote.',
      '$E = mc^2$',
      '$$\na^2 + b^2 = c^2\n$$',
      '```mermaid',
      '{#markdown-custom-heading .wide}',
      '> [!NOTE] Rendered callout',
      '::: tabs',
      '::: details [Open the Markdown details block]',
      '<details>',
      '```ts title="hello.ts" line-numbers {2}',
    ],
  },
]

it('always provides both standard notes with the preferred language first', () => {
  expect(welcomeNoteTemplates('zh-CN').map((note) => note.locale)).toEqual(['zh-CN', 'en-US'])
  expect(welcomeNoteTemplates('en-US').map((note) => note.locale)).toEqual(['en-US', 'zh-CN'])
  expect(new Set(welcomeNoteTemplates().map((note) => note.content))).toEqual(
    new Set([welcomeNoteContent('zh-CN'), welcomeNoteContent('en-US')]),
  )
})

function quickReference(testCase: TemplateCase): string {
  const content = welcomeNoteContent(testCase.locale)
  const start = content.indexOf(testCase.heading)
  const end = content.indexOf(testCase.nextHeading, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return content.slice(start, end)
}

function host(markdown: string): HTMLDivElement {
  const root = document.createElement('div')
  root.innerHTML = renderMarkdown(markdown).html
  return root
}

describe.each(CASES)('$locale welcome-note Markdown reference', (testCase) => {
  it('renders every documented syntax family as a real example', () => {
    const root = host(quickReference(testCase))
    const inlineCells = [...root.querySelectorAll('table tbody td:first-child')]
    expect(inlineCells.map((cell) => cell.textContent?.trim())).toEqual(testCase.inline)

    expect(root.querySelector('table strong')).not.toBeNull()
    expect(root.querySelector('table em')).not.toBeNull()
    expect(root.querySelector('table s')).not.toBeNull()
    expect(root.querySelector('table mark')).not.toBeNull()
    expect(root.querySelector('table ins')).not.toBeNull()
    expect(root.querySelector('table code')).not.toBeNull()
    expect(root.querySelector('table sub')).not.toBeNull()
    expect(root.querySelector('table sup')).not.toBeNull()
    const examples = [...root.querySelectorAll('.markdown-example')]
    expect(examples).toHaveLength(13)
    expect(examples.every((example) => example.querySelector('.markdown-example-preview'))).toBe(true)
    expect(examples.every((example) => example.querySelector('.markdown-example-source [data-copy]'))).toBe(true)
    expect(root.querySelector('.markdown-example-pane-label')).toBeNull()
    expect(root.querySelector('.markdown-example-source .code-block-head')).toBeNull()
    expect(root.querySelector('a[href="https://example.com"]')).not.toBeNull()
    expect(root.querySelector('img[src="/inkstone-logo.svg"]')).not.toBeNull()
    expect(root.querySelectorAll('.wikilink')).toHaveLength(3)
    expect(root.querySelector('[data-block-id="markdown-demo"]')).not.toBeNull()
    expect(root.querySelector('[data-block-ref="markdown-demo"]')).not.toBeNull()
    expect(root.querySelector('[data-embed-target]')).not.toBeNull()
    expect(root.querySelector('sup.footnote-ref')).not.toBeNull()
    expect(root.querySelector('.math-inline')).not.toBeNull()
    expect(root.querySelector('.math-block')).not.toBeNull()
    expect(root.querySelector('[data-mermaid]')).not.toBeNull()
    expect(root.querySelector('h5#markdown-custom-heading.wide')).not.toBeNull()
    expect(root.querySelector('.callout-note')).not.toBeNull()
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(root.querySelectorAll('details')).toHaveLength(2)
    expect(root.querySelector('.code-block[data-lang="ts"][data-line-numbers="true"]')).not.toBeNull()
    expect(root.textContent).not.toContain('\u6548\u679c\uff1a')
    expect(root.textContent).not.toContain('\u6e90\u7801\uff1a')
    expect(root.textContent).not.toContain('Result:')
    expect(root.textContent).not.toContain('Source:')
  })

  it('shows copyable source for every rendered example', () => {
    const root = host(quickReference(testCase))
    const source = [...root.querySelectorAll('code')].map((code) => code.textContent ?? '')
    for (const fragment of testCase.sourceFragments) {
      expect(source.some((code) => code.includes(fragment)), `missing source example: ${fragment}`).toBe(true)
    }
  })

  it('resolves the same-note embed into visible example content', async () => {
    const markdown = quickReference(testCase)
    const root = host(markdown)
    await resolveNoteEmbeds(root, { currentContent: markdown, currentTitle: 'Welcome' })
    const embed = root.querySelector<HTMLElement>('.note-embed.ready')
    expect(embed?.querySelector('.note-embed-body')?.textContent?.trim()).toBe(testCase.embeddedText)
  })
})

describe.each([
  {
    locale: 'zh-CN' as const,
    heading: '## \u73b0\u5728\u5c31\u8bd5\u8bd5',
    nextHeading: '## \u5e38\u7528 Windows \u5feb\u6377\u952e',
    tasks: ['\u5728 **\u8bbe\u7f6e → \u5907\u4efd** \u6dfb\u52a0\u4e00\u4e2a\u5907\u4efd\u76ee\u6807', '\u7ed9\u4e00\u7bc7\u7b14\u8bb0\u521b\u5efa\u5e26\u53e3\u4ee4\u7684\u5206\u4eab'],
    details: ['\u8bbe\u7f6e → \u5907\u4efd', '\u521b\u5efa\u5b89\u5168\u5206\u4eab', '\u8bbf\u95ee\u53e3\u4ee4', '\u6709\u6548\u671f', '\u9644\u4ef6'],
  },
  {
    locale: 'en-US' as const,
    heading: '## Try these now',
    nextHeading: '## Essential Windows shortcuts',
    tasks: ['Add a backup target under **Settings → Backup**', 'Create a password-protected share for a note'],
    details: ['Settings → Backup', 'Create a secure share', 'access password', 'expiration', 'Attachments'],
  },
])('$locale welcome-note first steps', ({ locale, heading, nextHeading, tasks, details }) => {
  it('keeps backup and secure sharing beside the first actions', () => {
    const content = welcomeNoteContent(locale)
    const start = content.indexOf(heading)
    const end = content.indexOf(nextHeading, start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const section = content.slice(start, end)
    for (const task of tasks) expect(section).toContain(`- [ ] ${task}`)
    for (const detail of details) expect(section).toContain(detail)
  })
})

it('ships the canonical project logo used by the rendered image example', () => {
  const image = resolve(process.cwd(), 'public/inkstone-logo.svg')
  expect(existsSync(image)).toBe(true)
  const source = readFileSync(image, 'utf8')
  expect(source).toContain('M16 8.2c2.7 3.5 5.4 6.3 5.4 9.3')
  expect(source).toContain('fill="#202124"')
  expect(source).toContain('fill="#bb4430"')
})

it('keeps the legacy welcome-note image on the canonical project mark', () => {
  const image = resolve(process.cwd(), 'public/inkstone-markdown-demo.svg')
  expect(existsSync(image)).toBe(true)
  const source = readFileSync(image, 'utf8')
  expect(source).toContain('M16 8.2c2.7 3.5 5.4 6.3 5.4 9.3')
  expect(source).not.toContain('M84 151c21-44')
})
