import { describe, expect, it } from 'vitest'
import { isTransientBackupError, readResponseBytesWithinLimit } from './common'

describe('bounded third-party responses', () => {
  it('reads a small response exactly', async () => {
    const result = await readResponseBytesWithinLimit(new Response('probe'), 16)
    expect(new TextDecoder().decode(result)).toBe('probe')
  })

  it('rejects declared and streamed responses over the limit', async () => {
    await expect(
      readResponseBytesWithinLimit(
        new Response('x', { headers: { 'Content-Length': '9999' } }),
        8,
      ),
    ).rejects.toThrow('exceeds the safety limit')

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6))
        controller.enqueue(new Uint8Array(6))
        controller.close()
      },
    })
    await expect(readResponseBytesWithinLimit(new Response(body), 8)).rejects.toThrow(
      'exceeds the safety limit',
    )
  })
})

describe('transient backup failures', () => {
  it.each([
    'HTTP 408',
    'HTTP 429',
    'HTTP 503',
    'fetch failed',
    'request timeout',
    'internal error; reference = abc',
  ])('retries %s', (message) => {
    expect(isTransientBackupError(new Error(message))).toBe(true)
  })

  it.each(['HTTP 400', 'HTTP 401', 'HTTP 403', 'HTTP 404', 'invalid key'])(
    'does not retry %s',
    (message) => {
      expect(isTransientBackupError(new Error(message))).toBe(false)
    },
  )
})
