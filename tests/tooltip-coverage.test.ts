import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const clientRoot = path.resolve(process.cwd(), 'src/client')

describe('icon tooltip coverage', () => {
  it('does not use native title tooltips on interactive controls', () => {
    const violations: string[] = []

    for (const file of sourceFiles(clientRoot)) {
      const source = parse(file)
      walk(source, (node) => {
        if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return
        const name = tagName(node.tagName)
        if (!name || !['button', 'a', 'IconButton'].includes(name)) return
        if (!node.attributes.properties.some(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === 'title',
        )) return
        violations.push(location(source, node))
      })
    }

    expect(violations, `Native title tooltips found:\n${violations.join('\n')}`).toEqual([])
  })

  it('wraps every shared IconButton with the app Tooltip', () => {
    const violations: string[] = []

    for (const file of sourceFiles(clientRoot)) {
      const source = parse(file)
      walk(source, (node) => {
        if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return
        if (tagName(node.tagName) !== 'IconButton') return
        if (hasJsxAncestor(node, 'Tooltip')) return
        violations.push(location(source, node))
      })
    }

    expect(violations, `IconButtons without app Tooltip:\n${violations.join('\n')}`).toEqual([])
  })
})

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(fullPath)
    if (!entry.isFile() || !entry.name.endsWith('.tsx') || entry.name.includes('.test.')) return []
    return [fullPath]
  })
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

function tagName(name: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isPropertyAccessExpression(name)) return name.name.text
  return null
}

function hasJsxAncestor(node: ts.Node, expectedName: string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && tagName(parent.openingElement.tagName) === expectedName) {
      return true
    }
  }
  return false
}

function location(source: ts.SourceFile, node: ts.Node): string {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
  return `${path.relative(process.cwd(), source.fileName)}:${line + 1}:${character + 1}`
}
