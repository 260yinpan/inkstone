import { describe, expect, it } from 'vitest'
import { SCHEMA_STATEMENTS } from './schema'

describe('database schema', () => {
  it('contains one complete initial structure with no upgrade operations', () => {
    const sql = SCHEMA_STATEMENTS.join('\n')
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map(
      (match) => match[1],
    )

    expect(tables).toEqual([
      'app_meta',
      'users',
      'folders',
      'notes',
      'tags',
      'note_tags',
      'links',
      'note_versions',
      'attachments',
      'attachment_cleanup',
      'import_mappings',
      'backup_targets',
      'backup_runs',
      'shares',
      'share_asset_sessions',
      'changes',
      'sessions',
      'login_attempts',
    ])
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS users[\s\S]*username TEXT NOT NULL UNIQUE/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS users[\s\S]*password_hash TEXT NOT NULL/)
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_unique_sibling/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS notes[\s\S]*title_key TEXT NOT NULL/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS attachments[\s\S]*sha256 TEXT NOT NULL/)
    expect(sql).toMatch(/storage TEXT NOT NULL CHECK \(storage IN \('r2', 'kv'\)\)/)
    expect(sql).not.toMatch(/\bdata BLOB\b/)
    expect(sql).toMatch(/object_key TEXT PRIMARY KEY CHECK \(object_key GLOB 'r2:\?\*' OR object_key GLOB 'kv:\?\*'\)/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS import_mappings[\s\S]*PRIMARY KEY \(user_id, entity, source_id\)/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS share_asset_sessions[\s\S]*password_hash TEXT NOT NULL/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_notes_title_key/)
    expect(sql).not.toMatch(/\b(?:ALTER|DROP)\s+TABLE\b/i)
    expect(sql).not.toMatch(/schema_version|users_v\d+/i)
  })
})
