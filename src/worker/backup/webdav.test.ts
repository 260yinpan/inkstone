import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebdavConfig } from '@shared/types'
import { webdavTest } from './webdav'

const config: WebdavConfig = {
  url: 'https://dav.example.com/backups',
  username: 'alice',
  prefix: '',
  mode: 'archive',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WebDAV credential boundaries', () => {
  it('uses manual redirect handling for every authenticated request', async () => {
    let probeBody = new Uint8Array()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PROPFIND') return new Response(null, { status: 207 })
      if (init?.method === 'PUT') {
        probeBody = new Uint8Array(await new Response(init.body).arrayBuffer())
        return new Response(null, { status: 201 })
      }
      if (init?.method === 'GET') return new Response(probeBody, { status: 200 })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(webdavTest(config, { password: 'secret' })).resolves.toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.redirect).toBe('manual')
      expect(new Headers(init?.headers).get('Authorization')).toMatch(/^Basic /)
    }
  })

  it('follows same-origin HTTPS redirects without changing the authenticated method', async () => {
    const redirectedMethods: string[] = []
    const redirectedUrls: string[] = []
    let probeBody = new Uint8Array()
    const redirectConfig = { ...config, prefix: 'inkstone' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      redirectedMethods.push(request.method)
      redirectedUrls.push(request.url)
      expect(request.headers.get('Authorization')).toMatch(/^Basic /)
      if (request.method === 'PROPFIND') return new Response(null, { status: 207 })
      if (request.method === 'MKCOL' && !request.url.endsWith('/')) {
        return new Response(null, {
          status: 301,
          headers: { Location: `${request.url}/` },
        })
      }
      if (request.method === 'MKCOL') return new Response(null, { status: 201 })
      if (request.method === 'PUT') {
        probeBody = new Uint8Array(await request.arrayBuffer())
        return new Response(null, { status: 201 })
      }
      if (request.method === 'GET') return new Response(probeBody, { status: 200 })
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(webdavTest(redirectConfig, { password: 'secret' })).resolves.toMatchObject({ ok: true })
    expect(redirectedMethods.slice(0, 3)).toEqual(['PROPFIND', 'MKCOL', 'MKCOL'])
    expect(redirectedUrls[2]).toBe(`${redirectedUrls[1]}/`)
    for (const [, init] of fetchMock.mock.calls) expect(init?.redirect).toBe('manual')
  })

  it('does not follow a redirect to another origin', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, {
        status: 302,
        headers: { Location: 'https://collector.example.net/' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(webdavTest(config, { password: 'secret' })).resolves.toMatchObject({
      ok: false,
      message: 'WebDAV redirected to another origin. Enter the final HTTPS URL to protect credentials',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('manual')
  })

  it('does not report success when the probe cannot be removed', async () => {
    let probeBody = new Uint8Array()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PROPFIND') return new Response(null, { status: 207 })
      if (init?.method === 'PUT') {
        probeBody = new Uint8Array(await new Response(init.body).arrayBuffer())
        return new Response(null, { status: 201 })
      }
      if (init?.method === 'GET') return new Response(probeBody, { status: 200 })
      return new Response(null, { status: 403 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await webdavTest(config, { password: 'secret' })
    expect(result).toMatchObject({ ok: false })
    expect(result.message).toContain('test file could not be removed')
  })
})
