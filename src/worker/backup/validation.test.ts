import { describe, expect, it } from 'vitest'
import {
  normalizeBackupPrefix,
  normalizeS3Region,
  parseBackupEndpoint,
  validateS3Bucket,
} from './validation'

describe('backup destination validation', () => {
  it('accepts public HTTPS endpoints and normalizes missing schemes', () => {
    expect(parseBackupEndpoint('dav.example.com/files/alice', "WebDAV address").toString())
      .toBe('https://dav.example.com/files/alice')
    expect(parseBackupEndpoint('https://s3.us-east-1.amazonaws.com', 'Endpoint').hostname)
      .toBe('s3.us-east-1.amazonaws.com')
  })

  it.each([
    'http://backup.example.com',
    'https://localhost/dav',
    'https://127.0.0.1/dav',
    'https://2130706433/dav',
    'https://10.2.3.4/dav',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/dav',
    'https://[::ffff:7f00:1]/dav',
    'https://metadata.google.internal/computeMetadata/v1',
    'https://user:secret@backup.example.com/dav',
    'https://backup.example.com/dav?token=secret',
    'https://backup.example.com/safe/%2e%2e/outside',
    'https://backup.example.com/safe%2f..%2foutside',
  ])('rejects unsafe endpoint %s', (value) => {
    expect(() => parseBackupEndpoint(value, 'Backup URL')).toThrow()
  })

  it('rejects traversal-like prefixes and normalizes safe prefixes', () => {
    expect(normalizeBackupPrefix('/Inkstone/\u6bcf\u65e5/')).toBe('Inkstone/\u6bcf\u65e5')
    expect(normalizeBackupPrefix('Inkstone\\\u6bcf\u65e5')).toBe('Inkstone/\u6bcf\u65e5')
    expect(() => normalizeBackupPrefix('../../outside')).toThrow()
    expect(() => normalizeBackupPrefix('safe/%2e%2e/outside')).toThrow()
    expect(() => normalizeBackupPrefix('safe\\..\\outside')).toThrow()
  })

  it('keeps region and bucket values out of generated hosts', () => {
    expect(normalizeS3Region('ap-northeast-1')).toBe('ap-northeast-1')
    expect(() => normalizeS3Region('us-east-1/evil')).toThrow()
    expect(validateS3Bucket('inkstone.backup', false)).toBe('inkstone.backup')
    expect(() => validateS3Bucket('evil.example.com@bucket', false)).toThrow()
    expect(validateS3Bucket('Local_Backup', true)).toBe('Local_Backup')
  })
})
