import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettingsPatch } from '@shared/constants'
import type { PublicUser, SessionInfo, SiteInfo, UserSettings } from '@shared/types'

const mocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, message: string) {
      super(message)
    }
    get isOffline() { return this.status === 0 }
  },
  save: vi.fn<(patch: unknown) => Promise<UserSettings>>(),
  get: vi.fn<() => Promise<UserSettings>>(),
  clear: vi.fn(async () => undefined),
  clearSession: vi.fn(async () => undefined),
  loadSession: vi.fn<() => Promise<SessionInfo | null>>(),
  saveSession: vi.fn<(info: SessionInfo) => Promise<void>>(async () => undefined),
  updateProfile: vi.fn<(patch: { name?: string; avatarUrl?: string }) => Promise<PublicUser>>(),
  session: vi.fn<() => Promise<SessionInfo>>(),
  login: vi.fn<(username: string, password: string) => Promise<SessionInfo>>(),
  register: vi.fn<(username: string, password: string) => Promise<SessionInfo>>(),
  logout: vi.fn<() => Promise<{ ok: true }>>(),
}))

vi.mock('../lib/api', () => ({
  api: {
    session: mocks.session,
    settings: { save: mocks.save, get: mocks.get },
    auth: {
      updateProfile: mocks.updateProfile,
      login: mocks.login,
      register: mocks.register,
    },
    logout: mocks.logout,
  },
  ApiError: mocks.ApiError,
}))

vi.mock('../lib/db', () => ({
  localDb: {
    clear: mocks.clear,
    clearSession: mocks.clearSession,
    loadSession: mocks.loadSession,
    saveSession: mocks.saveSession,
  },
}))

import { useSession } from './session'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal('location', {
    search: '',
    pathname: '/',
    hash: '',
    reload: vi.fn(),
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  useSession.setState({
    status: 'loading',
    user: null,
    site: null,
    settings: DEFAULT_SETTINGS,
    authError: null,
  })
  mocks.logout.mockResolvedValue({ ok: true })
  mocks.loadSession.mockResolvedValue(null)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('session request ordering', () => {
  it('cannot let an older load failure replace a newer successful session', async () => {
    const older = deferred<SessionInfo>()
    const newer = deferred<SessionInfo>()
    mocks.session
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    const first = useSession.getState().load()
    const second = useSession.getState().load()
    newer.resolve(sessionInfo(account()))
    await second
    older.reject(new Error('late failure'))
    await first

    expect(useSession.getState().status).toBe('authed')
    expect(useSession.getState().user?.id).toBe('user-1')
    expect(useSession.getState().authError).toBeNull()
  })

  it('cannot let a pending initialization response undo a newer login', async () => {
    const loading = deferred<SessionInfo>()
    mocks.session.mockImplementationOnce(() => loading.promise)
    mocks.login.mockResolvedValueOnce(sessionInfo(account()))

    const initial = useSession.getState().load()
    await useSession.getState().passwordLogin('alice', 'password')
    loading.resolve(sessionInfo(null))
    await initial

    expect(useSession.getState().status).toBe('authed')
    expect(useSession.getState().user?.username).toBe('alice')
  })
})

describe('logout lifecycle', () => {
  it('runs only one logout and local cleanup when called repeatedly', async () => {
    const pending = deferred<{ ok: true }>()
    mocks.logout.mockReturnValueOnce(pending.promise)

    const first = useSession.getState().logout()
    const second = useSession.getState().logout()

    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(mocks.clear).not.toHaveBeenCalled()

    pending.resolve({ ok: true })
    await Promise.all([first, second])

    expect(mocks.clear).toHaveBeenCalledOnce()
    expect(location.reload).toHaveBeenCalledOnce()
  })
})

describe('settings persistence', () => {
  it('coalesces and sends only fields changed by this tab', async () => {
    mocks.save.mockImplementationOnce(async (patch) => mergeSettingsPatch(DEFAULT_SETTINGS, patch))

    useSession.getState().updateSettings({ editor: { fontSize: 18 } })
    useSession.getState().updateSettings({ preview: { showToc: true } })
    await vi.advanceTimersByTimeAsync(421)

    expect(mocks.save).toHaveBeenCalledOnce()
    expect(mocks.save).toHaveBeenCalledWith({
      editor: { fontSize: 18 },
      preview: { showToc: true },
    })
  })

  it('serializes saves and preserves edits made while a request is running', async () => {
    const first = deferred<UserSettings>()
    mocks.save
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async (patch) => mergeSettingsPatch(
        mergeSettingsPatch(DEFAULT_SETTINGS, { editor: { fontSize: 18 } }),
        patch,
      ))

    useSession.getState().updateSettings({ editor: { fontSize: 18 } })
    await vi.advanceTimersByTimeAsync(421)
    expect(mocks.save).toHaveBeenCalledTimes(1)

    useSession.getState().updateSettings({ appearance: { accent: 'amber' } })
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.save).toHaveBeenCalledTimes(1)

    first.resolve(mergeSettingsPatch(DEFAULT_SETTINGS, { editor: { fontSize: 18 } }))
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))

    expect(mocks.save.mock.calls[1]?.[0]).toEqual({ appearance: { accent: 'amber' } })
    expect(useSession.getState().settings).toMatchObject({
      editor: { fontSize: 18 },
      appearance: { accent: 'amber' },
    })
  })

  it('does not let a save response from the previous session restore old settings', async () => {
    const pending = deferred<UserSettings>()
    mocks.save.mockImplementationOnce(() => pending.promise)

    useSession.getState().updateSettings({ appearance: { theme: 'dark' } })
    await vi.advanceTimersByTimeAsync(421)
    expect(mocks.save).toHaveBeenCalledOnce()

    await useSession.getState().logout()
    pending.resolve(mergeSettingsPatch(DEFAULT_SETTINGS, { appearance: { theme: 'dark' } }))
    await Promise.resolve()
    await Promise.resolve()

    expect(useSession.getState().settings).toEqual(DEFAULT_SETTINGS)
  })

  it('ignores a settings refresh that finishes after logout', async () => {
    const pending = deferred<UserSettings>()
    mocks.get.mockImplementationOnce(() => pending.promise)

    const refreshing = useSession.getState().refreshSettings()
    await useSession.getState().logout()
    pending.resolve(mergeSettingsPatch(DEFAULT_SETTINGS, { editor: { fontSize: 22 } }))
    await refreshing

    expect(useSession.getState().settings).toEqual(DEFAULT_SETTINGS)
  })

  it('cannot let an older refresh overwrite a newer settings response', async () => {
    const older = deferred<UserSettings>()
    const newer = deferred<UserSettings>()
    mocks.get
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    const first = useSession.getState().refreshSettings()
    const second = useSession.getState().refreshSettings()
    newer.resolve(mergeSettingsPatch(DEFAULT_SETTINGS, { editor: { fontSize: 21 } }))
    await second
    older.resolve(mergeSettingsPatch(DEFAULT_SETTINGS, { editor: { fontSize: 15 } }))
    await first

    expect(useSession.getState().settings.editor.fontSize).toBe(21)
  })

  it('cannot let an older save response overwrite a newer cross-tab refresh', async () => {
    const saving = deferred<UserSettings>()
    mocks.save.mockImplementationOnce(() => saving.promise)
    mocks.get.mockResolvedValueOnce(mergeSettingsPatch(DEFAULT_SETTINGS, {
      appearance: { accent: 'amber' },
      editor: { fontSize: 18 },
    }))

    useSession.getState().updateSettings({ editor: { fontSize: 18 } })
    await vi.advanceTimersByTimeAsync(421)
    await useSession.getState().refreshSettings()
    expect(useSession.getState().settings.appearance.accent).toBe('amber')

    saving.resolve(mergeSettingsPatch(DEFAULT_SETTINGS, { editor: { fontSize: 18 } }))
    await Promise.resolve()
    await Promise.resolve()

    expect(useSession.getState().settings.appearance.accent).toBe('amber')
    expect(useSession.getState().settings.editor.fontSize).toBe(18)
  })
})

describe('profile persistence', () => {
  const user: PublicUser = {
    id: 'user-1',
    username: 'alice',
    login: 'alice',
    name: 'Alice',
    avatarUrl: '',
    role: 'owner',
    createdAt: 1,
  }

  it('adopts the saved profile without changing the sign-in username', async () => {
    const updated = { ...user, name: 'Alice Chen', avatarUrl: 'dicebear:0123456789abcdef0123456789abcdef' }
    mocks.updateProfile.mockResolvedValueOnce(updated)
    useSession.setState({ user, status: 'authed' })

    await useSession.getState().updateProfile({ name: updated.name, avatarUrl: updated.avatarUrl })

    expect(mocks.updateProfile).toHaveBeenCalledWith({ name: updated.name, avatarUrl: updated.avatarUrl })
    expect(useSession.getState().user).toEqual(updated)
    expect(useSession.getState().user?.username).toBe('alice')
  })

  it('ignores a profile response after the user has signed out', async () => {
    const pending = deferred<PublicUser>()
    mocks.updateProfile.mockImplementationOnce(() => pending.promise)
    useSession.setState({ user, status: 'authed' })

    const saving = useSession.getState().updateProfile({ name: 'Later' })
    useSession.setState({ user: null, status: 'anonymous' })
    pending.resolve({ ...user, name: 'Later' })
    await saving

    expect(useSession.getState().user).toBeNull()
  })

  it('preserves unrelated profile fields when concurrent saves finish out of order', async () => {
    const nameSave = deferred<PublicUser>()
    const avatarSave = deferred<PublicUser>()
    const avatarUrl = 'dicebear:fedcba9876543210fedcba9876543210'
    mocks.updateProfile.mockImplementation((patch) => (
      patch.name === undefined ? avatarSave.promise : nameSave.promise
    ))
    useSession.setState({ user, status: 'authed' })

    const savingName = useSession.getState().updateProfile({ name: 'Alice Chen' })
    const savingAvatar = useSession.getState().updateProfile({ avatarUrl })
    avatarSave.resolve({ ...user, avatarUrl })
    await savingAvatar
    nameSave.resolve({ ...user, name: 'Alice Chen' })
    await savingName

    expect(useSession.getState().user).toMatchObject({ name: 'Alice Chen', avatarUrl })
  })
})

function account(): PublicUser {
  return {
    id: 'user-1',
    username: 'alice',
    login: 'alice',
    name: 'Alice',
    avatarUrl: '',
    role: 'owner',
    createdAt: 1,
  }
}

function sessionInfo(user: PublicUser | null): SessionInfo {
  return {
    user,
    site: site(Boolean(user)),
    settings: user ? DEFAULT_SETTINGS : null,
  }
}

function site(initialized: boolean): SiteInfo {
  return {
    name: 'Inkstone',
    initialized,
    registrationOpen: false,
    r2Enabled: false,
    kvEnabled: false,
    attachmentStorage: null,
    realtimeEnabled: false,
    version: '0.1.0',
  }
}
