import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'


export const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: 'cm-md-h1' },
  { tag: tags.heading2, class: 'cm-md-h2' },
  { tag: tags.heading3, class: 'cm-md-h3' },
  { tag: tags.heading4, class: 'cm-md-h4' },
  { tag: tags.heading5, class: 'cm-md-h5' },
  { tag: tags.heading6, class: 'cm-md-h6' },
  { tag: tags.strong, class: 'cm-md-strong' },
  { tag: tags.emphasis, class: 'cm-md-em' },
  { tag: tags.strikethrough, class: 'cm-md-strike' },
  { tag: tags.monospace, class: 'cm-md-code' },
  { tag: tags.quote, class: 'cm-md-quote' },
  { tag: tags.link, class: 'cm-md-link' },
  { tag: tags.url, class: 'cm-md-url' },
  { tag: tags.list, class: 'cm-md-list' },
  { tag: tags.contentSeparator, class: 'cm-md-hr' },
  { tag: tags.processingInstruction, class: 'cm-md-meta' },
  { tag: tags.labelName, class: 'cm-md-link' },


  { tag: tags.keyword, class: 'cm-t-keyword' },
  { tag: tags.controlKeyword, class: 'cm-t-keyword' },
  { tag: tags.moduleKeyword, class: 'cm-t-keyword' },
  { tag: tags.definitionKeyword, class: 'cm-t-keyword' },
  { tag: tags.operatorKeyword, class: 'cm-t-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'cm-t-string' },
  { tag: [tags.number, tags.integer, tags.float], class: 'cm-t-number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], class: 'cm-t-comment' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'cm-t-function' },
  {
    tag: [tags.definition(tags.typeName), tags.definition(tags.className)],
    class: 'cm-t-type-def',
  },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'cm-t-type' },
  { tag: [tags.propertyName, tags.attributeName], class: 'cm-t-property' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], class: 'cm-t-variable' },
  { tag: [tags.operator, tags.compareOperator, tags.arithmeticOperator, tags.logicOperator], class: 'cm-t-operator' },
  { tag: [tags.bool, tags.null, tags.atom, tags.self], class: 'cm-t-bool' },
  { tag: [tags.punctuation, tags.separator, tags.bracket, tags.paren, tags.brace], class: 'cm-t-punctuation' },
  { tag: tags.invalid, class: 'cm-t-invalid' },
  { tag: tags.tagName, class: 'cm-t-keyword' },
  { tag: tags.angleBracket, class: 'cm-t-punctuation' },
  { tag: tags.escape, class: 'cm-t-number' },
  { tag: tags.regexp, class: 'cm-t-string' },
])


export const baseTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { fontFamily: 'inherit' },
  '.cm-content': { paddingBlock: '4px' },
  '.cm-line': { paddingInline: '16px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-tooltip': { border: 'none', background: 'transparent' },
  '.cm-panels': { zIndex: '20' },
})

export function editorTheme(): Extension {
  return [baseTheme, syntaxHighlighting(markdownHighlight)]
}
