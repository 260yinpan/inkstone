import { describe, expect, it } from 'vitest'
import {
  createShareAssetSession,
  revokeShareAssetSessions,
  verifyShareAssetSession,
} from './share-asset-session'

const SLUG = 'b'.repeat(20)
const PASSWORD_HASH =
  'scrypt$16384$8$5$ABEiM0RVZneImaq7zN3u_w$EzsVp6WklW-qw8-htpRdJyzAeyRHPzojfjgoy1qFiRw'
const OTHER_PASSWORD_HASH = `${PASSWORD_HASH.slice(0, -1)}A`

describe('share attachment session', () => {
  it('stays hashed, slug-scoped, revocable, and password-version bound', async () => {
    const memory = createMemoryDatabase()
    const token = await createShareAssetSession(
      memory.db,
      SLUG,
      PASSWORD_HASH,
      Date.now() + 60_000,
    )

    expect(memory.share.has(token)).toBe(false)
    await expect(verifyShareAssetSession(memory.db, token, SLUG, PASSWORD_HASH)).resolves.toBe(true)
    await expect(
      verifyShareAssetSession(memory.db, token, SLUG, OTHER_PASSWORD_HASH),
    ).resolves.toBe(false)
    await revokeShareAssetSessions(memory.db, SLUG)
    await expect(verifyShareAssetSession(memory.db, token, SLUG, PASSWORD_HASH)).resolves.toBe(false)
  })
})

interface ShareMemoryRow {
  slug: string
  password_hash: string
  expires_at: number
}

function createMemoryDatabase(): { db: D1Database; share: Map<string, ShareMemoryRow> } {
  const share = new Map<string, ShareMemoryRow>()

  interface MemoryStatement extends D1PreparedStatement {
    executeRun(): Promise<D1Result>
  }

  const prepare = (source: string): MemoryStatement => {
    const sql = source.replace(/\s+/g, ' ').trim()
    let values: unknown[] = []
    const statement = {
      bind: (...next: unknown[]) => {
        values = next
        return statement
      },
      run: async () => executeRun(sql, values),
      executeRun: async () => executeRun(sql, values),
      first: async <T>() => executeFirst(sql, values) as T | null,
    } as unknown as MemoryStatement
    return statement
  }

  const executeRun = async (sql: string, values: unknown[]): Promise<D1Result> => {
    if (sql.startsWith('INSERT INTO share_asset_sessions')) {
      share.set(String(values[0]), {
        slug: String(values[1]),
        password_hash: String(values[2]),
        expires_at: Number(values[3]),
      })
    } else if (sql === 'DELETE FROM share_asset_sessions WHERE expires_at <= ?1') {
      for (const [id, row] of share) if (row.expires_at <= Number(values[0])) share.delete(id)
    } else if (sql === 'DELETE FROM share_asset_sessions WHERE slug = ?1') {
      for (const [id, row] of share) if (row.slug === values[0]) share.delete(id)
    } else {
      throw new Error(`unexpected run SQL: ${sql}`)
    }
    return { success: true, meta: { changes: 1 } } as unknown as D1Result
  }

  const executeFirst = (sql: string, values: unknown[]): unknown => {
    if (sql.startsWith('SELECT 1 AS present FROM share_asset_sessions')) {
      const row = share.get(String(values[0]))
      return row &&
        row.slug === values[1] &&
        row.password_hash === values[2] &&
        row.expires_at > Number(values[3])
        ? { present: 1 }
        : null
    }
    throw new Error(`unexpected first SQL: ${sql}`)
  }

  const db = {
    prepare,
    batch: async (statements: D1PreparedStatement[]) =>
      Promise.all(statements.map((statement) => (statement as MemoryStatement).executeRun())),
  } as unknown as D1Database

  return { db, share }
}
