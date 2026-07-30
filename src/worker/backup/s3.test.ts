import { afterEach, describe, expect, it, vi } from 'vitest'
import type { S3Config } from '@shared/types'
import { objectUrl, s3Test } from './s3'

const config: S3Config = {
  endpoint: 'https://s3.example.com',
  region: 'auto',
  bucket: 'inkstone-test',
  prefix: 'backups',
  pathStyle: true,
  mode: 'archive',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('S3 connection probe', () => {
  it('preserves an endpoint base path in both addressing modes', () => {
    expect(objectUrl({ ...config, endpoint: 'https://s3.example.com/gateway/' }, 'daily/a b.zip'))
      .toBe('https://s3.example.com/gateway/inkstone-test/daily/a%20b.zip')
    expect(objectUrl({
      ...config,
      endpoint: 'https://s3.example.com/gateway/',
      pathStyle: false,
    }, 'daily/a b.zip')).toBe(
      'https://inkstone-test.s3.example.com/gateway/daily/a%20b.zip',
    )
  })

  it('verifies the exact bytes and removes its unique probe', async () => {
    let payload = new Uint8Array()
    const methods: string[] = []
    const urls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      methods.push(request.method)
      urls.push(request.url)
      if (request.method === 'PUT') {
        payload = new Uint8Array(await request.arrayBuffer())
        return new Response(null, { status: 200 })
      }
      if (request.method === 'GET') return new Response(payload, { status: 200 })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      s3Test(config, { accessKeyId: 'access', secretAccessKey: 'secret' }),
    ).resolves.toMatchObject({ ok: true })
    expect(methods).toEqual(['PUT', 'GET', 'DELETE'])
    expect(new Set(urls).size).toBe(1)
    expect(urls[0]).toMatch(/\.inkstone-check-[0-9a-f-]+$/)
  })

  it('still removes the probe when read-back fails', async () => {
    const methods: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      methods.push(request.method)
      if (request.method === 'GET') return new Response('failed', { status: 403 })
      return new Response(null, { status: request.method === 'PUT' ? 200 : 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      s3Test(config, { accessKeyId: 'access', secretAccessKey: 'secret' }),
    ).resolves.toMatchObject({ ok: false })
    expect(methods).toEqual(['PUT', 'GET', 'DELETE'])
  })

  it('does not report success when the probe cannot be removed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (request.method === 'GET') return new Response('probe', { status: 200 })
      if (request.method === 'DELETE') return new Response(null, { status: 403 })
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await s3Test(config, {
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    })
    expect(result).toMatchObject({ ok: false })
    expect(result.message).toContain('test file could not be removed')
  })
})
