import { create } from 'zustand'
import { DEFAULT_SETTINGS, mergeSettings, mergeSettingsPatch } from '@shared/constants'
import type { PublicUser, SessionInfo, SiteInfo, UserSettings } from '@shared/types'
import { api, ApiError } from '../lib/api'
import { setLocale, t } from '../lib/i18n'
import { localDb } from '../lib/db'
import { applyThemeToDom, useUi } from './ui'

interface SessionState {
  status: 'loading' | 'anonymous' | 'authed'
  user: PublicUser | null
  site: SiteInfo | null
  settings: UserSettings
  authError: string | null

  load: () => Promise<void>
  passwordLogin: (username: string, password: string) => Promise<void>
  passwordRegister: (username: string, password: string) => Promise<void>
  refresh: () => Promise<void>
  refreshSettings: () => Promise<void>
  updateProfile: (patch: { name?: string; avatarUrl?: string }) => Promise<PublicUser>
  logout: () => Promise<void>
  updateSettings: (patch: DeepPartial<UserSettings>, options?: { silent?: boolean }) => void
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] }

let saveTimer: number | undefined
let pendingSettingsPatch: DeepPartial<UserSettings> | null = null
let inFlightSettingsPatch: DeepPartial<UserSettings> | null = null
let pendingSettingsShouldNotify = false
let settingsSaveInFlight = false
let settingsRetryDelay = 1_500
let settingsEpoch = 0
let settingsSaveToken = 0
let settingsUserId: string | null = null
let settingsRequestSequence = 0
let sessionRequestSequence = 0
let logoutPromise: Promise<void> | null = null

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,
  site: null,
  settings: DEFAULT_SETTINGS,
  authError: null,

  async load() {
    const sequence = ++sessionRequestSequence
    try {
      const info = await api.session()
      if (sequence !== sessionRequestSequence) return
      adopt(info, set)
    } catch (err) {
      if (sequence !== sessionRequestSequence) return
      set({
        status: 'anonymous',
        authError: err instanceof ApiError ? err.message : t("session.could_not_connect_to_the_server"),
      })
    }
  },

  async passwordLogin(username, password) {
    const sequence = ++sessionRequestSequence
    const info = await api.auth.login(username, password)
    if (sequence !== sessionRequestSequence) return
    adopt(info, set)
  },

  async passwordRegister(username, password) {
    const sequence = ++sessionRequestSequence
    const info = await api.auth.register(username, password)
    if (sequence !== sessionRequestSequence) return
    adopt(info, set)
  },


  async refresh() {
    const sequence = ++sessionRequestSequence
    const info = await api.session()
    if (sequence !== sessionRequestSequence) return
    adopt(info, set)
  },

  async refreshSettings() {
    const epoch = settingsEpoch
    const sequence = ++settingsRequestSequence
    const remote = await api.settings.get()
    if (epoch !== settingsEpoch || sequence !== settingsRequestSequence) return
    const localPatch = outstandingSettingsPatch()
    const settings = localPatch ? mergeSettingsPatch(remote, localPatch) : remote
    set({ settings })
    syncAppearanceToDom(settings)
  },

  async updateProfile(patch) {
    const expectedUserId = get().user?.id
    const user = await api.auth.updateProfile(patch)
    const current = get().user
    if (expectedUserId && user.id === expectedUserId && current?.id === expectedUserId) {
      set({
        user: {
          ...user,
          name: patch.name === undefined ? current.name : user.name,
          avatarUrl: patch.avatarUrl === undefined ? current.avatarUrl : user.avatarUrl,
        },
      })
    }
    return user
  },

  async logout() {
    if (logoutPromise) return logoutPromise
    sessionRequestSequence++
    resetSettingsPersistence(null)
    const task = (async () => {
      await api.logout().catch(() => {})
      await localDb.clear()
      set({ status: 'anonymous', user: null, settings: DEFAULT_SETTINGS })
      location.reload()
    })()
    logoutPromise = task
    try {
      await task
    } finally {
      if (logoutPromise === task) logoutPromise = null
    }
  },

  updateSettings(patch, options) {
    const next = mergeSettingsPatch(get().settings, patch)
    set({ settings: next })
    syncAppearanceToDom(next)
    pendingSettingsPatch = mergeSettingsPatches(pendingSettingsPatch, patch)
    pendingSettingsShouldNotify ||= !options?.silent


    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => void flushSettingsPatch(set, get), 420)
  },
}))

type SessionSetter = (partial: Partial<SessionState>) => void

async function flushSettingsPatch(set: SessionSetter, get: () => SessionState): Promise<void> {
  saveTimer = undefined
  if (settingsSaveInFlight || !pendingSettingsPatch) return

  const outgoing = pendingSettingsPatch
  const shouldNotify = pendingSettingsShouldNotify
  pendingSettingsPatch = null
  pendingSettingsShouldNotify = false
  inFlightSettingsPatch = outgoing
  settingsSaveInFlight = true
  const epoch = settingsEpoch
  const token = ++settingsSaveToken
  const responseSequence = ++settingsRequestSequence
  try {
    const saved = await api.settings.save(outgoing as Partial<UserSettings>)
    if (epoch !== settingsEpoch || token !== settingsSaveToken) return
    settingsRetryDelay = 1_500
    if (responseSequence === settingsRequestSequence) {
      const settings = pendingSettingsPatch
        ? mergeSettingsPatch(saved, pendingSettingsPatch)
        : saved
      set({ settings })
      syncAppearanceToDom(settings)
    }
  } catch (err) {
    if (epoch !== settingsEpoch || token !== settingsSaveToken) return

    pendingSettingsPatch = mergeSettingsPatches(outgoing, pendingSettingsPatch)
    if (shouldNotify) {
      useUi.getState().toast({
        title: t("session.could_not_save_settings"),
        description: err instanceof ApiError ? err.message : String(err),
        tone: 'danger',
      })
    }
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(
      () => void flushSettingsPatch(set, get),
      settingsRetryDelay,
    )
    settingsRetryDelay = Math.min(30_000, settingsRetryDelay * 2)
  } finally {
    if (epoch === settingsEpoch && token === settingsSaveToken) {
      inFlightSettingsPatch = null
      settingsSaveInFlight = false
      if (pendingSettingsPatch && saveTimer === undefined) {
        saveTimer = window.setTimeout(() => void flushSettingsPatch(set, get), 0)
      }
    }
  }
}

function resetSettingsPersistence(userId: string | null): void {
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  pendingSettingsPatch = null
  inFlightSettingsPatch = null
  pendingSettingsShouldNotify = false
  settingsSaveInFlight = false
  settingsRetryDelay = 1_500
  settingsUserId = userId
  settingsEpoch++
  settingsSaveToken++
  settingsRequestSequence++
}

function outstandingSettingsPatch(): DeepPartial<UserSettings> | null {
  return mergeSettingsPatches(inFlightSettingsPatch, pendingSettingsPatch)
}

function mergeSettingsPatches(
  first: DeepPartial<UserSettings> | null,
  second: DeepPartial<UserSettings> | null,
): DeepPartial<UserSettings> | null {
  if (!first) return second
  if (!second) return first
  return {
    ...(first.appearance || second.appearance
      ? { appearance: { ...first.appearance, ...second.appearance } }
      : {}),
    ...(first.editor || second.editor
      ? { editor: { ...first.editor, ...second.editor } }
      : {}),
    ...(first.preview || second.preview
      ? { preview: { ...first.preview, ...second.preview } }
      : {}),
    ...(first.backup || second.backup
      ? { backup: { ...first.backup, ...second.backup } }
      : {}),
    ...(first.sync || second.sync
      ? { sync: { ...first.sync, ...second.sync } }
      : {}),
  }
}

function adopt(info: SessionInfo, set: (partial: Partial<SessionState>) => void): void {
  const nextUserId = info.user?.id ?? null
  if (settingsUserId !== nextUserId) resetSettingsPersistence(nextUserId)
  const remote = mergeSettings(info.settings ?? {})
  const localPatch = outstandingSettingsPatch()
  const settings = localPatch ? mergeSettingsPatch(remote, localPatch) : remote
  set({
    status: info.user ? 'authed' : 'anonymous',
    user: info.user,
    site: info.site,
    settings,
    authError: null,
  })
  if (info.user) syncAppearanceToDom(settings)
}


export function syncAppearanceToDom(settings: UserSettings): void {
  const { appearance, preview } = settings
  const root = document.documentElement
  root.style.setProperty('--prose-size', `${appearance.proseSize}px`)
  root.style.setProperty('--prose-line', String(appearance.proseLineHeight))
  root.style.setProperty(
    '--prose-width',
    { narrow: '58ch', normal: '72ch', wide: '88ch', full: '100%' }[appearance.proseWidth] ?? '72ch',
  )
  root.style.setProperty('--editor-size', `${settings.editor.fontSize}px`)
  root.dataset.preview = preview.layout
  setLocale(appearance.language)

  useUi.getState().applyAppearance({
    theme: appearance.theme,
    accent: appearance.accent,
    fontScale: appearance.proseSize,
  })
  useUi.setState({ density: appearance.density })
}

export function watchSystemTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (useSession.getState().settings.appearance.theme === 'system') {
      applyThemeToDom(useUi.getState())
    }
  }
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
