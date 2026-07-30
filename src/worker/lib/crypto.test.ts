import { describe, expect, it } from 'vitest'
import type { Env } from '../env'
import { CredentialVault } from '../durable/credential-vault'
import { CryptoUnavailableError, decryptSecret, encryptSecret } from './crypto'

const TARGET_A = '01j00000000000000000000000'
const TARGET_B = '01j00000000000000000000001'

describe('automatic backup credential vault', () => {
  it('generates one private master key and round-trips target-bound ciphertext', async () => {
    const harness = createVaultHarness()
    const runtime = { CREDENTIAL_VAULT: harness.namespace } as Env
    const encrypted = await encryptSecret(runtime, TARGET_A, { password: 'secret' })

    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+$/)
    expect(encrypted).not.toContain('secret')
    await expect(decryptSecret(runtime, TARGET_A, encrypted)).resolves.toEqual({ password: 'secret' })
    await expect(decryptSecret(runtime, TARGET_B, encrypted)).resolves.toBeNull()
    expect(harness.values.size).toBe(1)
    expect([...harness.values.values()][0]).not.toContain('secret')
  })

  it('rejects tampered ciphertext without exposing the master key', async () => {
    const harness = createVaultHarness()
    const runtime = { CREDENTIAL_VAULT: harness.namespace } as Env
    const encrypted = await encryptSecret(runtime, TARGET_A, {
      accessKeyId: 'key',
      secretAccessKey: 'value',
    })
    const index = Math.floor(encrypted.length / 2)
    const replacement = encrypted[index] === 'A' ? 'B' : 'A'
    const tampered = `${encrypted.slice(0, index)}${replacement}${encrypted.slice(index + 1)}`

    await expect(decryptSecret(runtime, TARGET_A, tampered)).resolves.toBeNull()
  })

  it('fails closed when the shipped Durable Object binding was removed', async () => {
    await expect(encryptSecret({} as Env, TARGET_A, { password: 'secret' })).rejects.toBeInstanceOf(
      CryptoUnavailableError,
    )
  })
})

function createVaultHarness(): {
  namespace: DurableObjectNamespace
  values: Map<string, string>
} {
  const values = new Map<string, string>()
  const state = {
    storage: {
      get: async (key: string) => values.get(key),
      put: async (key: string, value: string) => {
        values.set(key, value)
      },
    },
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
  } as unknown as DurableObjectState
  const vault = new CredentialVault(state)
  const stub = {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      vault.fetch(new Request(input, init)),
  }
  const namespace = {
    idFromName: () => ({ toString: () => 'vault-id' }),
    get: () => stub,
  } as unknown as DurableObjectNamespace
  return { namespace, values }
}
