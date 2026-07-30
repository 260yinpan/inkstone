import { describe, expect, it } from 'vitest'
import { toBackupTarget, type TargetRow } from './engine'

describe('backup target response parsing', () => {
  it.each(['null', '[]', 'false', 'invalid'])('normalizes non-object config %s', (config) => {
    expect(toBackupTarget(targetRow(config)).config).toEqual({})
  })

  it('preserves a valid config object', () => {
    expect(toBackupTarget(targetRow('{"mode":"mirror","prefix":"notes"}')).config)
      .toEqual({ mode: 'mirror', prefix: 'notes' })
  })
})

function targetRow(config: string): TargetRow {
  return {
    id: '01K00000000000000000000000',
    user_id: '01K00000000000000000000001',
    type: 'webdav',
    name: 'Backup',
    enabled: 1,
    config,
    secret: null,
    last_run_at: null,
    last_status: null,
    last_error: null,
    created_at: 1,
    updated_at: 1,
  }
}
