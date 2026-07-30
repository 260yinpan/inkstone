import { describe, expect, it } from 'vitest'
import { buildNoteDerivedStatements } from './writes'

class CapturedStatement {
  readonly values: unknown[] = []

  constructor(readonly sql: string) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values.push(...values)
    return this as unknown as D1PreparedStatement
  }
}

function captureDatabase(): D1Database {
  return {
    prepare(sql: string) {
      return new CapturedStatement(sql) as unknown as D1PreparedStatement
    },
  } as D1Database
}

function generatedSql(deleted: boolean): string[] {
  return buildNoteDerivedStatements({
    db: captureDatabase(),
    userId: 'user-1',
    noteId: 'note-1',
    title: 'Restored note',
    content: '#tag [[Target note]] searchable body',
    ftsEnabled: true,
    deleted,
  }).statements.map((statement) => (statement as unknown as CapturedStatement).sql)
}

describe('note derived writes', () => {
  it('indexes active notes as backlink sources and full-text documents', () => {
    const sql = generatedSql(false)

    expect(sql.some((text) => text.includes('INSERT INTO links'))).toBe(true)
    expect(sql.some((text) => text.includes('INSERT INTO notes_fts'))).toBe(true)
  })

  it('keeps trash metadata while removing search and backlink source rows', () => {
    const sql = generatedSql(true)

    expect(sql.some((text) => text.includes('UPDATE notes SET title_key'))).toBe(true)
    expect(sql.some((text) => text.includes('INSERT INTO note_tags'))).toBe(true)
    expect(sql.some((text) => text.includes('DELETE FROM links'))).toBe(true)
    expect(sql.some((text) => text.includes('DELETE FROM notes_fts'))).toBe(true)
    expect(sql.some((text) => text.includes('INSERT INTO links'))).toBe(false)
    expect(sql.some((text) => text.includes('INSERT INTO notes_fts'))).toBe(false)
  })
})
