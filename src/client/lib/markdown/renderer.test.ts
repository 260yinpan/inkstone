import { describe, expect, it } from 'vitest'
import { parseFrontMatter } from '@shared/markdown-utils'
import { extractBlock, extractHeadingSection, resolveNoteEmbeds } from './embeds'
import { decorateCodeBlock } from './enhance'
import { parseFenceInfo, parseWikiTarget, renderMarkdown } from './renderer'
import { updateTaskAtSourceLine } from '../../editor/commands'

function host(html: string): HTMLDivElement {
  const element = document.createElement('div')
  element.innerHTML = html
  return element
}

describe('standard Markdown lists', () => {
  it('renders ordered and unordered list semantics', () => {
    const root = host(renderMarkdown('1. First\n2. Second\n\n- Alpha\n- Beta\n  - Nested').html)

    expect(root.querySelectorAll('ol > li')).toHaveLength(2)
    expect(root.querySelectorAll('ul > li')).toHaveLength(3)
  })
})

describe('trusted task lists', () => {
  it('keeps generated checkboxes with exact nested source lines', () => {
    const rendered = renderMarkdown('- [ ] parent\n  - [x] child\n  - [ ] sibling')
    const root = host(rendered.html)
    const inputs = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(inputs).toHaveLength(3)
    expect(inputs.map((input) => input.dataset.taskLine)).toEqual(['0', '1', '2'])
    expect(inputs.map((input) => input.checked)).toEqual([false, true, false])
    expect(root.querySelectorAll('li.task-list-item')).toHaveLength(3)
  })

  it('still removes every input supplied by raw HTML', () => {
    const rendered = renderMarkdown(
      '<input type="checkbox" class="task-list-item-checkbox" data-task-line="0" checked onclick="alert(1)">',
    )
    expect(host(rendered.html).querySelector('input')).toBeNull()
  })

  it('tracks ordered tasks inside callouts and only edits the exact source line', () => {
    const source = '> [!TODO] Work\r\n> 1. [ ] first\r\n>    - [x] nested'
    const root = host(renderMarkdown(source).html)
    const tasks = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(tasks.map((input) => input.dataset.taskLine)).toEqual(['1', '2'])

    expect(updateTaskAtSourceLine(source, 2, false)).toBe(
      '> [!TODO] Work\r\n> 1. [ ] first\r\n>    - [ ] nested',
    )
    expect(updateTaskAtSourceLine(source, 0, true)).toBeNull()
  })
})

describe('modern note syntax', () => {
  it('supports safe native and fenced details', () => {
    const rendered = renderMarkdown(
      '<details open onclick="alert(1)"><summary>Native</summary>Safe<script>alert(1)</script></details>\n\n::: details open [More]\nInside\n:::',
    )
    const root = host(rendered.html)
    expect(root.querySelectorAll('details')).toHaveLength(2)
    expect(root.querySelectorAll('summary')[1]?.textContent).toBe('More')
    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('details')?.hasAttribute('onclick')).toBe(false)
  })

  it('renders Obsidian callouts and tabs', () => {
    const rendered = renderMarkdown(
      '> [!WARNING]- Read first\n> Hidden body\n\n::: tabs\n@tab One\nFirst\n@tab Two\nSecond\n:::',
    )
    const root = host(rendered.html)
    expect(root.querySelector('details.callout-warning')).not.toBeNull()
    expect(root.querySelector('.callout-title')?.textContent).toBe('Read first')
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(root.querySelectorAll('[role="tabpanel"]')).toHaveLength(2)
    expect(root.querySelectorAll('[role="tabpanel"][hidden]')).toHaveLength(1)
  })

  it('parses full YAML Front Matter and hides its source fence', () => {
    const source = '---\ntitle: Demo\ntags: [one, two]\nmeta:\n  nested: true\n---\n# Body'
    const parsed = parseFrontMatter(source)
    expect(parsed.data).toMatchObject({ title: 'Demo', tags: ['one', 'two'], meta: { nested: true } })
    const rendered = renderMarkdown(source)
    expect(rendered.frontMatter).toMatchObject({ title: 'Demo', tags: ['one', 'two'] })
    expect(rendered.html).not.toContain('title: Demo')
    expect(host(rendered.html).querySelector('.frontmatter-properties')).not.toBeNull()
  })

  it('supports embeds, block IDs, block references and Pandoc attributes', () => {
    const rendered = renderMarkdown(
      'Paragraph ^important\n\n# Heading {#custom .wide}\n\n![[Other#Part]] and ((important))\n\n![Alt](https://example.com/a.png){#hero width=320}',
    )
    const root = host(rendered.html)
    expect(root.querySelector('[data-block-id="important"]')?.id).toBe('^important')
    expect(root.querySelector('h1#custom')?.classList.contains('wide')).toBe(true)
    expect(root.querySelector('[data-embed-target]')).not.toBeNull()
    expect(root.querySelector('[data-block-ref="important"]')).not.toBeNull()
    expect(root.querySelector('img#hero')?.getAttribute('width')).toBe('320')
  })

  it('parses code titles, line numbers and highlighted lines', () => {
    const info = parseFenceInfo('ts title="app.ts" line-numbers {1,3-4} start=10')
    expect(info).toMatchObject({
      language: 'ts',
      title: 'app.ts',
      lineNumbers: true,
      startLine: 10,
      highlightedLines: [1, 3, 4],
    })
    const rendered = renderMarkdown('```ts title="app.ts" line-numbers {2}\na\nb\n```')
    const block = host(rendered.html).querySelector('.code-block')
    expect(block?.getAttribute('data-line-numbers')).toBe('true')
    expect(block?.getAttribute('data-highlight-lines')).toBe('2')
    expect(block?.querySelector('.code-title')?.textContent).toBe('app.ts')
  })

  it('renders a Markdown example card from one source of truth', () => {
    const source = '~~~~md-example title="Link example"\n[Open example](https://example.com)\n~~~~'
    const root = host(renderMarkdown(source).html)
    const example = root.querySelector<HTMLElement>('.markdown-example')
    expect(example?.querySelector('.markdown-example-title')?.textContent).toBe('Link example')
    expect(example?.querySelector('.markdown-example-preview a')?.getAttribute('href')).toBe('https://example.com')
    expect(example?.querySelector('.markdown-example-source code')?.textContent).toBe('[Open example](https://example.com)\n')
    expect(example?.querySelector('.markdown-example-source [data-copy]')).not.toBeNull()
    expect(example?.querySelector('.markdown-example-pane-label')).toBeNull()
    expect(example?.querySelector('.markdown-example-source .code-block-head')).toBeNull()
  })

  it('keeps rich example previews functional while source stays inert', () => {
    const source = [
      '~~~~md-example title="Rich example"',
      '$E = mc^2$',
      '',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '<script>globalThis.compromised = true</script>',
      '~~~~',
    ].join('\n')
    const rendered = renderMarkdown(source)
    const root = host(rendered.html)
    expect(rendered.hasMath).toBe(true)
    expect(rendered.hasMermaid).toBe(true)
    expect(root.querySelector('.markdown-example-preview .math-inline')).not.toBeNull()
    expect(root.querySelectorAll('.markdown-example-preview [data-mermaid]')).toHaveLength(1)
    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('.markdown-example-source code')?.textContent).toContain('<script>globalThis.compromised = true</script>')
  })

  it('isolates footnotes and makes example tasks read-only', () => {
    const source = [
      '~~~~md-example title="First"',
      '- [ ] Read-only task',
      '',
      'First note.[^same]',
      '',
      '[^same]: First definition.',
      '~~~~',
      '',
      '~~~~md-example title="Second"',
      'Second note.[^same]',
      '',
      '[^same]: Second definition.',
      '~~~~',
    ].join('\n')
    const root = host(renderMarkdown(source).html)
    const task = root.querySelector<HTMLInputElement>('.markdown-example-preview input[type="checkbox"]')
    const footnoteIds = [...root.querySelectorAll<HTMLElement>('.markdown-example-preview .footnote-item')].map((item) => item.id)
    expect(task?.disabled).toBe(true)
    expect(task?.hasAttribute('data-task-line')).toBe(false)
    expect(new Set(footnoteIds).size).toBe(2)
    expect(footnoteIds.every((id) => /^fn-example-\d+-1$/.test(id))).toBe(true)
  })

  it('resolves same-example block embeds against the example source', async () => {
    const source = [
      '~~~~md-example title="Embed"',
      'Reusable content. ^inside-example',
      '',
      '![[#^inside-example]]',
      '~~~~',
    ].join('\n')
    const root = host(renderMarkdown(source).html)
    await resolveNoteEmbeds(root, { currentContent: source, currentTitle: 'Home' })
    expect(root.querySelector('.markdown-example-preview .note-embed.ready .note-embed-body')?.textContent?.trim()).toBe('Reusable content.')
  })

  it('supports Pandoc-style fenced code metadata and decorates visible lines', () => {
    expect(parseFenceInfo('{.python .numberLines startFrom=10 hl_lines="2 4" title="demo.py"}')).toMatchObject({
      language: 'python',
      title: 'demo.py',
      lineNumbers: true,
      startLine: 10,
      highlightedLines: [2, 4],
    })

    const root = host('<div class="code-block" data-code-start="10" data-line-numbers="true" data-highlight-lines="2"><pre><code>a\nb\nc\n</code></pre></div>')
    const block = root.querySelector<HTMLElement>('.code-block')!
    decorateCodeBlock(block)
    const lines = [...block.querySelectorAll<HTMLElement>('.line')]
    expect(lines.map((line) => line.dataset.lineNumber)).toEqual(['10', '11', '12'])
    expect(lines[1]?.classList.contains('highlighted')).toBe(true)
  })

  it('does not turn HTML, JSX, event handlers, or javascript URLs into executable content', () => {
    const root = host(renderMarkdown(
      '<Widget onclick="alert(1)"><script>alert(1)</script></Widget>\n\n' +
      '[bad](javascript:alert(1)) <img src=x onerror="alert(1)">',
    ).html)
    expect(root.querySelector('widget, script')).toBeNull()
    expect(root.querySelector('[onclick], [onerror]')).toBeNull()
    expect([...root.querySelectorAll<HTMLAnchorElement>('a')].some((link) => link.href.startsWith('javascript:'))).toBe(false)
  })

  it('isolates every new-window link and exposes inline tags to the keyboard', () => {
    const root = host(renderMarkdown(
      '<a href="https://example.com" target="_blank" rel="opener">Raw link</a>\n\nText #project',
    ).html)
    const link = root.querySelector<HTMLAnchorElement>('a[target="_blank"]')
    const tag = root.querySelector<HTMLElement>('.inline-tag')

    expect(link?.rel).toBe('noopener noreferrer')
    expect(tag?.textContent).toBe('#project')
    expect(tag?.getAttribute('role')).toBe('link')
    expect(tag?.tabIndex).toBe(0)
  })

  it('resolves same-note heading embeds and makes embedded tasks read-only', async () => {
    const source = '# Home\n\n![[#Part]]\n\n## Part\n- [ ] embedded task'
    const root = host(renderMarkdown(source).html)
    await resolveNoteEmbeds(root, { currentContent: source, currentTitle: 'Home' })
    const embed = root.querySelector<HTMLElement>('.note-embed.ready')
    const task = embed?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(embed?.textContent).toContain('embedded task')
    expect(task?.disabled).toBe(true)
    expect(task?.hasAttribute('data-task-line')).toBe(false)
  })

  it('stops whole-note self-embed cycles', async () => {
    const source = '# Home\n\n![[Home]]'
    const root = host(renderMarkdown(source).html)
    await resolveNoteEmbeds(root, { currentContent: source, currentTitle: 'Home' })
    expect(root.querySelector('.note-embed.error')).not.toBeNull()
  })
})

describe('wiki targets and section extraction', () => {
  it('parses note, heading, block and alias targets', () => {
    expect(parseWikiTarget('Note#Heading|Alias')).toMatchObject({
      noteTitle: 'Note',
      heading: 'Heading',
      blockId: null,
      alias: 'Alias',
    })
    expect(parseWikiTarget('Note#^block')).toMatchObject({ noteTitle: 'Note', blockId: 'block' })
  })

  it('extracts bounded heading sections and multiline blocks', () => {
    const markdown = '# A\nintro\n\n## Wanted\nline one\nline two ^keep\n\n## Next\nend'
    expect(extractHeadingSection(markdown, 'Wanted')).toBe('## Wanted\nline one\nline two ^keep')
    expect(extractBlock(markdown, 'keep')).toBe('line one\nline two')
  })
})
