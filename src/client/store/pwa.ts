import { create } from 'zustand'
import { t } from '../lib/i18n'
import { useUi } from './ui'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface PwaState {
  installAvailable: boolean
  installed: boolean
  installing: boolean
  install: () => Promise<void>
}

let installPrompt: InstallPromptEvent | null = null
let initialized = false
let updateToastShown = false
let reloadForUpdate = false

export const usePwa = create<PwaState>((set) => ({
  installAvailable: false,
  installed: isStandalone(),
  installing: false,

  async install() {
    const prompt = installPrompt
    if (!prompt) return
    installPrompt = null
    set({ installAvailable: false, installing: true })
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (choice.outcome === 'accepted') set({ installed: true })
    } finally {
      set({ installing: false })
    }
  },
}))

export function initializePwa(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt = event as InstallPromptEvent
    usePwa.setState({ installAvailable: true })
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    usePwa.setState({ installAvailable: false, installed: true, installing: false })
  })

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadForUpdate) location.reload()
  })
  void registerServiceWorker()
}

async function registerServiceWorker(): Promise<void> {
  try {
    const wasControlled = Boolean(navigator.serviceWorker.controller)
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })

    if (registration.waiting && wasControlled) notifyUpdate(registration.waiting)
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      if (!worker) return
      worker.addEventListener('statechange', () => {
        if (worker.state !== 'installed') return
        if (navigator.serviceWorker.controller) notifyUpdate(worker)
      })
    })

    const ready = await navigator.serviceWorker.ready
    if (!wasControlled && ready.active) {
      useUi.getState().toast({
        title: t('pwa.offline_ready'),
        description: t('pwa.offline_ready_description'),
        tone: 'success',
      })
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void registration.update().catch(() => {})
    })
  } catch {
  }
}

function notifyUpdate(worker: ServiceWorker): void {
  if (updateToastShown) return
  updateToastShown = true
  const durationMs = 30_000
  useUi.getState().toast({
    title: t('pwa.update_ready'),
    description: t('pwa.update_ready_description'),
    tone: 'default',
    duration: durationMs,
    action: {
      label: t('pwa.refresh_now'),
      run: () => {
        void applyUpdate(worker)
      },
    },
  })
  // Reset the flag once the toast is gone, so a later installed worker can
  // notify again instead of being permanently suppressed.
  window.setTimeout(() => {
    updateToastShown = false
  }, durationMs + 2_000)
}

async function applyUpdate(worker: ServiceWorker): Promise<void> {
  const { useNotes } = await import('./notes')
  await useNotes.getState().flush({ immediate: true }).catch(() => {})
  reloadForUpdate = true
  worker.postMessage({ type: 'SKIP_WAITING' })
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
}
