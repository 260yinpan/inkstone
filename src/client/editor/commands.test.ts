import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import {
  insertAdvancedCodeBlock,
  insertBlockId,
  insertCallout,
  setHeading,
  insertCodeBlock,
  insertDefinitionList,
  insertDetails,
  insertFootnote,
  insertFrontMatter,
  insertHorizontalRule,
  insertImage,
  insertLink,
  insertMermaid,
  insertPandocAttributes,
  insertTable,
  insertTabs,
  insertTag,
  insertText,
  toggleBlockReference,
  toggleBold,
  toggleBulletList,
  toggleHighlight,
  toggleInserted,
  toggleInlineCode,
  toggleInlineMath,
  toggleItalic,
  toggleNoteEmbed,
  toggleOrderedList,
  toggleQuote,
  toggleStrikethrough,
  toggleSubscript,
  toggleSuperscript,
  toggleTaskList,
  toggleTaskDone,
  toggleWikiLink,
} from './commands'

function applyCommandState(command: StateCommand, doc: string, from: number, to: number): EditorState {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.range(from, to),
  })
  const handled = command({
    state,
    dispatch: (transaction) => {
      state = transaction.state
    },
  })
  expect(handled).toBe(true)
  return state
}

function applyCommand(command: StateCommand, doc: string, from: number, to: number): string {
  return applyCommandState(command, doc, from, to).doc.toString()
}

describe('Markdown line commands', () => {
  it('does not change the next line when a selection ends at its first character', () => {
    const doc = 'first\nsecond\nthird'
    const secondLine = doc.indexOf('second')

    expect(applyCommand(toggleBulletList, doc, 0, secondLine)).toBe('- first\nsecond\nthird')
    expect(applyCommand(setHeading(2), doc, 0, secondLine)).toBe('## first\nsecond\nthird')
  })

  it('only toggles task rows that are visually selected', () => {
    const doc = '- [ ] first\n- [ ] second'
    const secondLine = doc.indexOf('- [ ] second')

    expect(applyCommand(toggleTaskDone, doc, 0, secondLine)).toBe('- [x] first\n- [ ] second')
  })

  it('preserves indentation while adding and removing list markers', () => {
    const doc = '  first\n\tsecond'
    const listed = applyCommand(toggleBulletList, doc, 0, doc.length)

    expect(listed).toBe('  - first\n\t- second')
    expect(applyCommand(toggleBulletList, listed, 0, listed.length)).toBe(doc)
  })

  it.each([
    { name: 'heading', command: setHeading(2), markdown: '## ', cursor: 3 },
    { name: 'quote', command: toggleQuote, markdown: '> ', cursor: 2 },
    { name: 'unordered list', command: toggleBulletList, markdown: '- ', cursor: 2 },
    { name: 'ordered list', command: toggleOrderedList, markdown: '1. ', cursor: 3 },
    { name: 'task list', command: toggleTaskList, markdown: '- [ ] ', cursor: 6 },
  ])('places the cursor after the $name marker', ({ command, markdown, cursor }) => {
    const state = applyCommandState(command, '', 0, 0)

    expect(state.doc.toString()).toBe(markdown)
    expect(state.selection.main.empty).toBe(true)
    expect(state.selection.main.head).toBe(cursor)
  })

  it('keeps the cursor next to content while adding and removing a line marker', () => {
    const listed = applyCommandState(toggleOrderedList, 'item', 0, 0)
    expect(listed.selection.main.head).toBe(3)

    const plain = applyCommandState(toggleOrderedList, listed.doc.toString(), 3, 3)
    expect(plain.doc.toString()).toBe('item')
    expect(plain.selection.main.head).toBe(0)
  })

  it('replaces other list markers instead of stacking or leaving fragments', () => {
    expect(applyCommand(toggleOrderedList, '- bullet', 8, 8)).toBe('1. bullet')
    expect(applyCommand(toggleBulletList, '1. ordered', 10, 10)).toBe('- ordered')
    expect(applyCommand(toggleTaskList, '1. ordered', 10, 10)).toBe('- [ ] ordered')
    expect(applyCommand(toggleBulletList, '- [x] task', 10, 10)).toBe('- task')
    expect(applyCommand(toggleOrderedList, '- [ ] task', 10, 10)).toBe('1. task')
  })

  it.each([
    { name: 'bold', command: toggleBold, markdown: '****', cursor: 2 },
    { name: 'italic', command: toggleItalic, markdown: '**', cursor: 1 },
    { name: 'strikethrough', command: toggleStrikethrough, markdown: '~~~~', cursor: 2 },
    { name: 'inline code', command: toggleInlineCode, markdown: '``', cursor: 1 },
    { name: 'highlight', command: toggleHighlight, markdown: '====', cursor: 2 },
    { name: 'inserted text', command: toggleInserted, markdown: '++++', cursor: 2 },
    { name: 'subscript', command: toggleSubscript, markdown: '~~', cursor: 1 },
    { name: 'superscript', command: toggleSuperscript, markdown: '^^', cursor: 1 },
    { name: 'inline math', command: toggleInlineMath, markdown: '$$', cursor: 1 },
    { name: 'wiki link', command: toggleWikiLink, markdown: '[[]]', cursor: 2 },
    { name: 'note embed', command: toggleNoteEmbed, markdown: '![[]]', cursor: 3 },
    { name: 'block reference', command: toggleBlockReference, markdown: '(())', cursor: 2 },
    { name: 'link', command: insertLink(), markdown: '[]()', cursor: 1 },
    { name: 'remote image', command: insertImage(), markdown: '![]()', cursor: 2 },
    { name: 'tag', command: insertTag, markdown: '#', cursor: 1 },
  ])('places the cursor in the editable slot for $name', ({ command, markdown, cursor }) => {
    const state = applyCommandState(command, '', 0, 0)

    expect(state.doc.toString()).toBe(markdown)
    expect(state.selection.main.head).toBe(cursor)
  })

  it('places block helpers at their first editable position', () => {
    const math = applyCommandState(insertText('$$\n\n$$\n', 3), '', 0, 0)
    expect(math.doc.toString()).toBe('$$\n\n$$\n')
    expect(math.selection.main.head).toBe(3)

    const table = applyCommandState(insertTable, '', 0, 0)
    expect(table.doc.toString()).toMatch(/^\| /)
    expect(table.selection.main.head).toBe(2)

    const rule = applyCommandState(insertHorizontalRule, '', 0, 0)
    expect(rule.doc.toString()).toBe('---\n\n')
    expect(rule.selection.main.head).toBe(rule.doc.length)
  })

  it('creates a valid footnote pair in an empty note and edits the definition', () => {
    const state = applyCommandState(insertFootnote, '', 0, 0)

    expect(state.doc.toString()).toBe('[^1]\n\n[^1]: ')
    expect(state.selection.main.head).toBe(state.doc.length)
  })

  it('adds italic to bold text without removing bold', () => {
    expect(applyCommand(toggleItalic, '**bold**', 0, 8)).toBe('***bold***')
    expect(applyCommand(toggleItalic, '**bold**', 2, 6)).toBe('***bold***')
    expect(applyCommand(toggleItalic, '***bold***', 0, 10)).toBe('**bold**')
  })

  it('uses a longer code delimiter when selected text contains backticks', () => {
    expect(applyCommand(toggleInlineCode, 'a`b', 0, 3)).toBe('``a`b``')
    expect(applyCommand(toggleInlineCode, '``a`b``', 0, 7)).toBe('a`b')
    expect(applyCommand(toggleInlineCode, '`` ` ``', 0, 7)).toBe('`')
    expect(applyCommand(toggleInlineCode, '`  a  `', 0, 7)).toBe(' a ')
  })

  it('keeps inserted links and fenced blocks syntactically closed', () => {
    expect(applyCommand(insertLink(), 'a]b', 0, 3)).toBe('[a\\]b]()')
    expect(applyCommand(insertImage(), 'alt]text', 0, 8)).toBe('![alt\\]text]()')
    expect(applyCommand(insertCodeBlock, 'before\n```\nafter', 0, 16)).toBe(
      '````\nbefore\n```\nafter\n````\n',
    )
  })

  it('toggles ordered and quoted task rows', () => {
    const doc = '> 1. [ ] quoted\n- [x] plain'
    expect(applyCommand(toggleTaskDone, doc, 0, doc.length)).toBe(
      '> 1. [x] quoted\n- [ ] plain',
    )
  })

  it('wraps every supported extended inline style without dropping the selection', () => {
    expect(applyCommand(toggleInserted, 'text', 0, 4)).toBe('++text++')
    expect(applyCommand(toggleSubscript, '2', 0, 1)).toBe('~2~')
    expect(applyCommand(toggleSuperscript, '2', 0, 1)).toBe('^2^')
    expect(applyCommand(toggleInlineMath, 'E=mc^2', 0, 6)).toBe('$E=mc^2$')
    expect(applyCommand(toggleWikiLink, 'Note', 0, 4)).toBe('[[Note]]')
    expect(applyCommand(toggleNoteEmbed, 'Note', 0, 4)).toBe('![[Note]]')
    expect(applyCommand(toggleBlockReference, 'block-id', 0, 8)).toBe('((block-id))')
  })

  it('inserts note relationship syntax and keeps existing content', () => {
    expect(applyCommand(insertBlockId, 'paragraph', 0, 9)).toBe('paragraph ^')
    expect(applyCommand(insertFootnote, 'One[^1]\n\n[^1]: Existing', 3, 3)).toBe(
      'One[^2][^1]\n\n[^1]: Existing\n\n[^2]: ',
    )
    expect(applyCommand(insertFootnote, 'Text', 4, 4)).toBe('Text[^1]\n\n[^1]: ')
    expect(applyCommand(insertFootnote, 'Text[^1].', 4, 4)).toBe('Text[^2][^1].\n\n[^2]: ')
  })

  it('wraps selected content in supported block extensions', () => {
    expect(applyCommand(insertMermaid, 'A --> B', 0, 7)).toBe('```mermaid\nA --> B\n```\n')
    expect(applyCommand(insertAdvancedCodeBlock, 'const value = 1', 0, 15)).toBe(
      '```text title="" line-numbers {1}\nconst value = 1\n```\n',
    )
    expect(applyCommand(insertCallout, 'line one\nline two', 0, 17)).toBe(
      '> [!NOTE]\n> line one\n> line two',
    )
    expect(applyCommand(insertDetails, 'hidden', 0, 6)).toBe('::: details []\nhidden\n:::\n')
  })

  it('inserts complete block skeletons and metadata helpers', () => {
    expect(applyCommand(insertTabs, '', 0, 0)).toContain('::: tabs\n@tab ')
    expect(applyCommand(insertTabs, 'First panel', 0, 11)).toMatch(/@tab (?:\u6807\u7b7e 1|Tab 1)\nFirst panel/)
    expect(applyCommand(insertDefinitionList, 'Term', 0, 4)).toBe('Term\n: ')
    const definition = applyCommandState(insertDefinitionList, '', 0, 0)
    expect(definition.sliceDoc(definition.selection.main.from, definition.selection.main.to)).toMatch(/^(?:Term|\u672f\u8bed)$/)
    expect(applyCommand(insertPandocAttributes, '# Heading', 9, 9)).toBe('# Heading {#id .class}')
    expect(applyCommand(insertPandocAttributes, 'inline', 0, 6)).toBe('[inline]{#id .class}')
    expect(applyCommand(insertFrontMatter, '# Heading', 0, 0)).toBe(
      '---\ntitle: \ntags: []\n---\n\n# Heading',
    )
    expect(applyCommand(insertFrontMatter, '---\ntitle: Old\n---\n', 0, 0)).toBe(
      '---\ntitle: Old\n---\n',
    )
  })
})
