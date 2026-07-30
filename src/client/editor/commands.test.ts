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
  insertImage,
  insertLink,
  insertMermaid,
  insertPandocAttributes,
  insertTabs,
  toggleBlockReference,
  toggleBulletList,
  toggleInserted,
  toggleInlineCode,
  toggleInlineMath,
  toggleItalic,
  toggleNoteEmbed,
  toggleSubscript,
  toggleSuperscript,
  toggleTaskDone,
  toggleWikiLink,
} from './commands'

function applyCommand(command: StateCommand, doc: string, from: number, to: number): string {
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
  return state.doc.toString()
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
