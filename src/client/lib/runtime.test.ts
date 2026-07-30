import { describe, expect, it } from 'vitest'
import { DEMO_CREDENTIALS, initialLoginCredentials } from './runtime'

describe('runtime login defaults', () => {
  it('prefills the fixed account only in demo mode', () => {
    expect(initialLoginCredentials(true)).toEqual(DEMO_CREDENTIALS)
    expect(initialLoginCredentials(false)).toEqual({ username: '', password: '' })
  })
})
