

import { describe, expect, it } from 'vitest'
import { clampInt, readFormDataWithinLimit, readJson, readOptionalJson } from './request'

function jsonContext(body: string, headers?: Record<string, string>) {
  const raw = new Request('https://inkstone.test/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
  return {
    req: {
      raw,
      text: () => raw.text(),
      json: () => raw.json(),
      header: (name: string) =>
        name.toLowerCase() === 'content-length' ? undefined : raw.headers.get(name) ?? undefined,
    },
  }
}

describe('bounded JSON requests', () => {
  it('accepts a JSON object within the actual UTF-8 byte limit', async () => {
    await expect(readJson<{ ok: boolean }>(jsonContext('{"ok":true}'), 32)).resolves.toEqual({
      ok: true,
    })
  })

  it('rejects an oversized streamed body even without Content-Length', async () => {
    const body = JSON.stringify({ password: 'x'.repeat(5000) })
    await expect(readJson(jsonContext(body), 4096)).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    })
  })

  it('counts UTF-8 bytes instead of JavaScript characters', async () => {
    const body = JSON.stringify({ value: '\u4e2d\u4e2d' })
    expect(body.length).toBeLessThan(new TextEncoder().encode(body).byteLength)
    await expect(readJson(jsonContext(body), body.length)).rejects.toMatchObject({ status: 413 })
  })

  it('uses Content-Length to reject a declared oversized body before parsing', async () => {
    const context = jsonContext('{"ok":true}')
    context.req.header = (name: string) => name.toLowerCase() === 'content-length' ? '999' : undefined
    await expect(readJson(context, 32)).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    })
  })

  it('defaults only a truly empty optional body and still rejects malformed JSON', async () => {
    const emptyRequest = new Request('https://inkstone.test/api/backup/run', { method: 'POST' })
    const empty = {
      req: {
        raw: emptyRequest,
        text: () => emptyRequest.text(),
        json: () => emptyRequest.json(),
        header: (name: string) => emptyRequest.headers.get(name) ?? undefined,
      },
    }
    await expect(readOptionalJson(empty, 32, { fallback: true })).resolves.toEqual({ fallback: true })
    await expect(readOptionalJson(jsonContext('{'), 32, {})).rejects.toMatchObject({ status: 400 })
  })
})

describe('bounded multipart requests', () => {
  function multipartRequest(size: number) {
    const form = new FormData()
    form.set('file', new File([new Uint8Array(size)], 'note.md', { type: 'text/markdown' }))
    const raw = new Request('https://inkstone.test/api/import', {
      method: 'POST',
      body: form,
    })
    return {
      raw,
      header: (name: string) =>
        name.toLowerCase() === 'content-length' ? undefined : raw.headers.get(name) ?? undefined,
    }
  }

  it('parses multipart bodies within the actual byte limit', async () => {
    const form = await readFormDataWithinLimit(multipartRequest(32), 1024)
    expect(form.get('file')).toBeInstanceOf(File)
  })

  it('rejects oversized streamed multipart bodies without Content-Length', async () => {
    const raw = new Request('https://inkstone.test/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=inkstone-test' },
      body: new Uint8Array(4096),
    })
    await expect(readFormDataWithinLimit({
      raw,
      header: (name) =>
        name.toLowerCase() === 'content-length' ? undefined : raw.headers.get(name) ?? undefined,
    }, 1024)).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    })
  })

  it('rejects a non-multipart content type before parsing', async () => {
    const raw = new Request('https://inkstone.test/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    await expect(
      readFormDataWithinLimit({
        raw,
        header: (name) => raw.headers.get(name) ?? undefined,
      }, 1024),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('integer query parameters', () => {
  it('uses the fallback for missing and blank values instead of treating blank as zero', () => {
    expect(clampInt(undefined, 1, 1000, 500)).toBe(500)
    expect(clampInt('', 1, 1000, 500)).toBe(500)
    expect(clampInt('   ', 1, 1000, 500)).toBe(500)
  })

  it('still truncates and clamps finite numeric values', () => {
    expect(clampInt('4.9', 1, 10, 5)).toBe(4)
    expect(clampInt('99', 1, 10, 5)).toBe(10)
  })
})
