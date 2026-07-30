import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const clientRoot = path.resolve(process.cwd(), 'src/client')

describe('global and editor shortcut ownership', () => {
  it('keeps Ctrl+B exclusively in CodeMirror and exposes no navigation hint for it', () => {
    const appShell = read('features/shell/AppShell.tsx')
    const sidebar = fs.readFileSync(path.join(clientRoot, 'features/sidebar/Sidebar.tsx'), 'utf8')
    const noteList = fs.readFileSync(path.join(clientRoot, 'features/list/NoteList.tsx'), 'utf8')
    const globals = globalHotkeys(appShell)

    expect(globals.map((item) => item.combo)).not.toContain('mod+b')
    expect(`${sidebar}\n${noteList}`).not.toMatch(/combo=["']mod\+b["']/i)
  })

  it('does not let an input-enabled global shortcut shadow a CodeMirror command', () => {
    const globals = globalHotkeys(read('features/shell/AppShell.tsx'))
    const editorCombos = editorHotkeys(read('editor/CodeEditor.tsx'))
    const collisions = globals
      .filter((item) => item.allowInInput && editorCombos.has(item.combo))
      .map((item) => item.combo)

    expect(collisions).toEqual([])
  })
})

function read(relativePath: string): ts.SourceFile {
  const filename = path.join(clientRoot, relativePath)
  return ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function globalHotkeys(source: ts.SourceFile): Array<{ combo: string; allowInInput: boolean }> {
  const result: Array<{ combo: string; allowInInput: boolean }> = []
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'registerAll') return
    const list = node.arguments[0]
    if (!list || !ts.isArrayLiteralExpression(list)) return
    for (const element of list.elements) {
      if (!ts.isObjectLiteralExpression(element)) continue
      const combo = stringProperty(element, 'combo')
      if (!combo) continue
      result.push({ combo: normalize(combo), allowInInput: booleanProperty(element, 'allowInInput') })
    }
  })
  return result
}

function editorHotkeys(source: ts.SourceFile): Set<string> {
  const result = new Set<string>()
  walk(source, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return
    const combo = stringProperty(node, 'key')
    if (combo) result.add(normalize(combo.replaceAll('-', '+')))
  })
  return result
}

function stringProperty(node: ts.ObjectLiteralExpression, name: string): string | null {
  const property = node.properties.find(
    (item): item is ts.PropertyAssignment =>
      ts.isPropertyAssignment(item) && propertyName(item.name) === name,
  )
  return property && ts.isStringLiteralLike(property.initializer) ? property.initializer.text : null
}

function booleanProperty(node: ts.ObjectLiteralExpression, name: string): boolean {
  const property = node.properties.find(
    (item): item is ts.PropertyAssignment =>
      ts.isPropertyAssignment(item) && propertyName(item.name) === name,
  )
  return Boolean(property && property.initializer.kind === ts.SyntaxKind.TrueKeyword)
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null
}

function normalize(combo: string): string {
  return combo.toLowerCase()
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}
