import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  onBroadcast: null as ((payload: unknown) => void) | null,
  post: vi.fn(),
  closeBroadcast: vi.fn(),
  pull: vi.fn(),
  replayPending: vi.fn(),
  setOnline: vi.fn(),
  flush: vi.fn(),
  sockets: [] as MockWebSocket[],
}))

vi.mock('./api', () => ({ CLIENT_ID: 'client-test' }))

vi.mock('./db', () => ({
  createBroadcast: (onMessage: (payload: unknown) => void) => {
    mocks.onBroadcast = onMessage
    return { post: mocks.post, close: mocks.closeBroadcast }
  },
}))

vi.mock('../store/notes', () => {
  const state = {
    cursor: 0,
    pull: mocks.pull,
    replayPending: mocks.replayPending,
    setOnline: mocks.setOnline,
    flush: mocks.flush,
    bootstrap: vi.fn(),
  }
  const useNotes = (selector: (value: unknown) => unknown) => selector(state)
  useNotes.getState = () => state
  return {
    useNotes,
    acknowledgeOutboxBaseAdvanced: vi.fn(),
    acknowledgeOutboxResult: vi.fn(),
  }
})

vi.mock('../store/session', () => ({
  useSession: (selector: (value: unknown) => unknown) => selector({
    site: { realtimeEnabled: false },
    settings: { sync: { realtime: false, pollIntervalMs: 30_000 } },
  }),
}))

import { SyncEngine } from './sync'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
  mocks.pull.mockResolvedValue(undefined)
  mocks.replayPending.mockResolvedValue(undefined)
  mocks.flush.mockResolvedValue(undefined)
  mocks.sockets = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.clearAllMocks()
  mocks.onBroadcast = null
})

describe('sync engine scheduling', () => {
  it('pulls and replays pending writes promptly when connectivity returns', async () => {
    const engine = new SyncEngine(false, 60_000)
    engine.start()

    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(49)
    expect(mocks.pull).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(mocks.setOnline).toHaveBeenCalledWith(true)
    expect(mocks.pull).toHaveBeenCalledTimes(1)
    expect(mocks.replayPending).toHaveBeenCalledTimes(1)
    engine.dispose()
  })

  it('does not let a later low-priority event postpone an earlier pull', async () => {
    const engine = new SyncEngine(false, 60_000)
    engine.start()

    broadcast({ type: 'pulled', clientId: 'other', cursor: 1 })
    await vi.advanceTimersByTimeAsync(50)
    broadcast({ type: 'local-write', clientId: 'client-test' })
    await vi.advanceTimersByTimeAsync(99)
    expect(mocks.pull).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(mocks.pull).toHaveBeenCalledTimes(1)
    engine.dispose()
  })

  it('cannot let an old socket close callback orphan a newer connection', async () => {
    const engine = new SyncEngine(true, 60_000)
    engine.start()
    await vi.advanceTimersByTimeAsync(260)
    const oldSocket = mocks.sockets[0]!
    expect(oldSocket).toBeDefined()

    broadcast({ type: 'claim-leader', clientId: 'other', at: Date.now() + 1 })
    await vi.advanceTimersByTimeAsync(2)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(260)
    expect(mocks.sockets).toHaveLength(2)

    oldSocket.onclose?.(new Event('close') as CloseEvent)
    await vi.advanceTimersByTimeAsync(2_000)

    expect(mocks.sockets).toHaveLength(2)
    engine.dispose()
  })

  it('ignores malformed broadcast and realtime messages without disrupting valid updates', async () => {
    const engine = new SyncEngine(true, 60_000)
    engine.start()

    expect(() => broadcast(null)).not.toThrow()
    await vi.advanceTimersByTimeAsync(260)
    const socket = mocks.sockets[0]!
    expect(socket).toBeDefined()

    expect(() => socket.onmessage?.(new MessageEvent('message', { data: 'null' }))).not.toThrow()
    expect(() => socket.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ type: 'changed', cursor: '1', origin: null }),
    }))).not.toThrow()
    await vi.advanceTimersByTimeAsync(180)
    expect(mocks.pull).not.toHaveBeenCalled()

    socket.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ type: 'changed', cursor: 1, origin: null }),
    }))
    await vi.advanceTimersByTimeAsync(180)
    expect(mocks.pull).toHaveBeenCalledOnce()

    engine.dispose()
  })
})

function broadcast(payload: unknown): void {
  if (!mocks.onBroadcast) throw new Error('Missing broadcast listener')
  mocks.onBroadcast(payload)
}

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly url: string
  readyState = MockWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    mocks.sockets.push(this)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
  }

  send(): void {}
}
