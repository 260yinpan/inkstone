import { describe, expect, it } from 'vitest'
import { forEachConcurrent } from './concurrency'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('bounded backup concurrency', () => {
  it('waits for in-flight work to settle before reporting a failure', async () => {
    const fail = deferred()
    const finish = deferred()
    let inFlightFinished = false
    let outerSettled = false

    const running = forEachConcurrent([0, 1, 2], 2, async (item) => {
      if (item === 0) {
        await fail.promise
        throw new Error('failed')
      }
      if (item === 1) {
        await finish.promise
        inFlightFinished = true
      }
    }).finally(() => {
      outerSettled = true
    })

    fail.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(outerSettled).toBe(false)

    finish.resolve()
    await expect(running).rejects.toThrow('failed')
    expect(inFlightFinished).toBe(true)
  })
})
