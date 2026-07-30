import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../../lib/i18n'
import { getBackupPresets } from './backupPresets'

afterEach(() => setLocale('zh-CN', false))

describe('backup provider guides', () => {
  it('uses the provider-specific setup links', () => {
    setLocale('zh-CN', false)
    const presets = getBackupPresets()
    const hrefs = presets.flatMap((preset) => preset.steps.flatMap((step) => step.flatMap((part) => part.href ?? [])))

    expect(hrefs).toEqual(expect.arrayContaining([
      'https://app.koofr.net/app/admin/preferences/password',
      'https://secure.backblaze.com/b2_buckets.htm',
      'https://secure.backblaze.com/app_keys.htm',
      'https://dash.cloudflare.com/?to=/:account/r2/new',
      'https://dash.cloudflare.com/?to=/:account/r2/api-tokens/create?type=user',
      'https://console.storage.dev/createbucket',
      'https://console.storage.dev/createaccesskey',
    ]))
  })

  it('includes Koofr linked-storage WebDAV addresses', () => {
    const koofr = getBackupPresets().find((preset) => preset.id === 'koofr')

    expect(koofr?.addresses).toEqual([
      { label: 'Koofr', url: 'https://app.koofr.net/dav/Koofr' },
      { label: 'Google Drive', url: 'https://app.koofr.net/dav/Google Drive' },
      { label: 'OneDrive', url: 'https://app.koofr.net/dav/OneDrive' },
      { label: 'Dropbox', url: 'https://app.koofr.net/dav/Dropbox' },
    ])
  })

  it('omits the S3 path-prefix closing instruction', () => {
    const guideText = getBackupPresets()
      .flatMap((preset) => preset.steps)
      .flatMap((step) => step)
      .map((part) => part.text)
      .join('')

    expect(guideText).not.toContain('\u8def\u5f84\u524d\u7f00\u6309\u9700\u8981\u586b\u5199')
    expect(getBackupPresets().find((preset) => preset.id === 'backblaze')?.steps).toHaveLength(4)
    expect(getBackupPresets().find((preset) => preset.id === 'r2')?.steps).toHaveLength(4)
    expect(getBackupPresets().find((preset) => preset.id === 'tigris')?.steps).toHaveLength(4)
  })
})
