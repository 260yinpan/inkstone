import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('API request deadlines', () => {
  it('turns a hung note save into a retryable offline error', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_path: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'))
      }, { once: true })
    })))

    const request = api.notes.patch('timeout-note', { rev: 1, content: '# Still local' })
    const rejected = expect(request).rejects.toMatchObject({
      status: 0,
      code: 'request_timeout',
    } satisfies Partial<ApiError>)

    await vi.advanceTimersByTimeAsync(30_000)
    await rejected
  })
})

describe('API response decoding', () => {
  it('preserves a valid JSON null response instead of reading the body twice', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('null', {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }))))

    await expect(api.session()).resolves.toBeNull()
  })

  it('reports malformed successful JSON as a server response error, not an offline error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{', {
      headers: { 'Content-Type': 'Application/JSON' },
    }))))

    await expect(api.session()).rejects.toMatchObject({
      status: 502,
      code: 'invalid_response',
      isOffline: false,
    } satisfies Partial<ApiError>)
  })
})
