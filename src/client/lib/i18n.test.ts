import { afterEach, describe, expect, it } from 'vitest'
import { mergeSettings } from '@shared/constants'
import { EN_US_MESSAGES, ZH_CN_MESSAGES, setLocale, t, type MessageKey } from './i18n'
import { formatNumber, fullTime, relativeTime } from './time'
import { hotkeyText } from './hotkeys'

afterEach(() => setLocale('zh-CN', false))

describe('interface localization', () => {
  it('switches messages, hotkey labels, numbers, and dates without reloading', () => {
    const liveLabel = () => t("common.command_palette")

    setLocale('zh-CN', false)
    expect(hotkeyText(liveLabel)).toBe(ZH_CN_MESSAGES['common.command_palette'])

    setLocale('en-US', false)
    expect(hotkeyText(liveLabel)).toBe('Command palette')
    expect(t("common.note")).toBe('Note')
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(relativeTime(Date.now() - 2 * 60_000)).toMatch(/2 minutes ago/i)
    expect(fullTime(new Date(2026, 6, 28, 15, 30).getTime())).toMatch(/2026/)
  })

  it('contains no Han text in the English resource', () => {
    const untranslated = Object.values(EN_US_MESSAGES).filter(
      (value) => /\p{Script=Han}/u.test(value),
    )
    expect(untranslated).toEqual([])
  })

  it('preserves every interpolation placeholder in English messages', () => {
    const placeholders = (value: string) => [...value.matchAll(/\{[A-Za-z0-9_]+\}/g)].map((match) => match[0]).sort()
    const mismatches = Object.entries(EN_US_MESSAGES).filter(
      ([key, translated]) => JSON.stringify(placeholders(ZH_CN_MESSAGES[key as MessageKey])) !== JSON.stringify(placeholders(translated)),
    )
    expect(mismatches).toEqual([])
  })

  it('validates the only two supported locale settings', () => {
    expect(mergeSettings({ appearance: { language: 'en-US' } }).appearance.language).toBe('en-US')
    expect(mergeSettings({ appearance: { language: 'fr-FR' } }).appearance.language).toBe('zh-CN')
  })
})
