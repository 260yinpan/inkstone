import { describe, expect, it } from 'vitest'
import { deriveTitle, extractTags } from '@shared/markdown-utils'
import type { ExportBundle, SessionInfo, SyncResponse, UserSettings } from '@shared/types'
import { welcomeNoteTemplates } from '@shared/welcome-notes'
import { readZip } from '@shared/zip'
import { createDemoBackend } from './backend'

const origin = 'https://demo.inkstone.test'

function multipartFile(filename: string, type: string, content: string): RequestInit {
  const boundary = `inkstone-demo-${crypto.randomUUID()}`
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${type}`,
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n')
  return {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  }
}

function client() {
  const backend = createDemoBackend()
  const request = (path: string, init?: RequestInit) => backend.fetch(new Request(`${origin}${path}`, init))
  const json = async <T>(path: string, init?: RequestInit): Promise<{ response: Response; data: T }> => {
    const response = await request(path, init)
    return { response, data: await response.json() as T }
  }
  const post = <T>(path: string, body: unknown) => json<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const login = () => post<SessionInfo>('/api/auth/login', { username: 'admin', password: 'password' })
  return { request, json, post, login }
}

describe('browser-only demo backend', () => {
  it('keeps the login screen and accepts only the prefilled demo credentials', async () => {
    const demo = client()
    const anonymous = await demo.json<SessionInfo>('/api/auth/session')
    expect(anonymous.data.user).toBeNull()
    expect(anonymous.data.site).toMatchObject({ initialized: true, realtimeEnabled: false })

    const wrong = await demo.post('/api/auth/login', { username: 'admin', password: 'wrong' })
    expect(wrong.response.status).toBe(401)

    const loggedIn = await demo.login()
    expect(loggedIn.response.status).toBe(200)
    expect(loggedIn.data.user).toMatchObject({ username: 'admin', name: 'Demo Admin', role: 'owner' })

    const sync = await demo.json<SyncResponse>('/api/sync?since=0')
    const templates = welcomeNoteTemplates('zh-CN')
    expect(sync.data.full).toBe(true)
    expect(sync.data.notes).toHaveLength(2)
    expect(sync.data.notes.map((note) => note.title)).toEqual(
      templates.map((template) => deriveTitle(template.content)),
    )
    expect(sync.data.folders).toHaveLength(0)
    const expectedTags = [...new Set(templates.flatMap((template) => extractTags(template.content)))]
    expect(sync.data.tags.map((tag) => tag.name)).toEqual(expect.arrayContaining(expectedTags))

    const seededContents = await Promise.all(sync.data.notes.map(async (note) => {
      const full = await demo.json<{ content: string }>(`/api/notes/${note.id}`)
      return full.data.content
    }))
    expect(seededContents).toEqual(templates.map((template) => template.content))
  })

  it('supports note, folder, tag, search, graph, version and share interactions', async () => {
    const demo = client()
    await demo.login()

    const created = await demo.post<{ id: string; rev: number }>('/api/notes', {
      title: 'Demo changes',
      content: '# Demo changes\n\nLink to [[Welcome to Inkstone]].\n\n#temporary',
    })
    expect(created.response.status).toBe(201)

    const patched = await demo.json<{ rev: number; isStarred: boolean }>(`/api/notes/${created.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: created.data.rev, title: 'Updated demo', isStarred: true, content: '# Updated demo\n\n#temporary' }),
    })
    expect(patched.data).toMatchObject({ rev: 2, isStarred: true })

    const versions = await demo.json<{ versions: unknown[] }>(`/api/notes/${created.data.id}/versions`)
    expect(versions.data.versions).toHaveLength(1)

    const folder = await demo.post<{ id: string }>('/api/folders', { name: 'Demo folder' })
    expect(folder.response.status).toBe(201)
    const tags = await demo.json<{ tags: Array<{ id: string; name: string }> }>('/api/tags')
    const temporary = tags.data.tags.find((tag) => tag.name === 'temporary')
    expect(temporary).toBeTruthy()
    const recolored = await demo.json<{ color: string }>(`/api/tags/${temporary!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color: '#ff0000' }),
    })
    expect(recolored.data.color).toBe('#ff0000')

    const search = await demo.json<{ results: unknown[] }>('/api/search?q=Updated&limit=20')
    expect(search.data.results).toHaveLength(1)
    const graph = await demo.json<{ nodes: unknown[]; edges: unknown[] }>('/api/graph')
    expect(graph.data.nodes).toHaveLength(3)

    const share = await demo.post<{ share: { url: string } }>(`/api/share/${created.data.id}`, {})
    expect(share.data.share.url).toMatch(/^https:\/\/demo\.inkstone\.test\/s\/demo-/)
    const slug = share.data.share.url.split('/').at(-1)!
    const publicNote = await demo.post<{ title: string }>(`/api/public/${slug}`, {})
    expect(publicNote.data.title).toBe('Updated demo')
  })

  it('handles settings, attachments, backup controls and restorable exports in memory', async () => {
    const demo = client()
    await demo.login()

    const settings = await demo.json<UserSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appearance: { theme: 'dark' }, preview: { layout: 'split' } }),
    })
    expect(settings.data.appearance.theme).toBe('dark')
    expect(settings.data.preview.layout).toBe('split')

    const upload = await demo.json<{ id: string; url: string }>(
      '/api/files',
      multipartFile('demo.txt', 'text/plain', 'demo image'),
    )
    expect(upload.response.status).toBe(201)
    expect(upload.data.url).toMatch(/^(?:blob:|data:)/)
    const listed = await demo.json<{ files: unknown[] }>('/api/files')
    expect(listed.data.files).toHaveLength(1)
    const prune = await demo.post<{ removed: number }>('/api/files/prune', {})
    expect(prune.data.removed).toBe(1)

    const target = await demo.post<{ id: string }>('/api/backup/targets', {
      type: 'webdav',
      name: 'Demo WebDAV',
      config: { url: 'https://example.test/dav', username: 'admin', prefix: '', mode: 'archive' },
      secret: { password: 'secret' },
    })
    expect(target.response.status).toBe(201)
    const connection = await demo.post<{ ok: boolean }>(`/api/backup/targets/${target.data.id}/test`, {})
    expect(connection.data.ok).toBe(true)
    const run = await demo.post<{ status: string }>('/api/backup/run', { targetIds: [target.data.id] })
    expect(run.data.status).toBe('success')

    const zip = await demo.request('/api/export?format=zip')
    expect(zip.headers.get('content-type')).toBe('application/zip')
    const entries = await readZip(new Uint8Array(await zip.arrayBuffer()))
    const bundleEntry = entries.find((entry) => entry.path === 'inkstone-export.json')
    expect(bundleEntry).toBeTruthy()
    const bundle = JSON.parse(new TextDecoder().decode(bundleEntry!.data)) as ExportBundle
    expect(bundle.notes).toHaveLength(2)

    const imported = await demo.json<{ createdNotes: number }>('/api/import', {
      ...multipartFile('demo.json', 'application/json', JSON.stringify(bundle)),
    })
    expect(imported.data.createdNotes).toBe(2)
  })

  it('starts from the original seed whenever a new page runtime is created', async () => {
    const first = client()
    await first.login()
    await first.post('/api/notes', { content: '# Temporary page state' })
    await first.json('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appearance: { theme: 'dark' } }),
    })

    const reloaded = client()
    await reloaded.login()
    const sync = await reloaded.json<SyncResponse>('/api/sync?since=0')
    const settings = await reloaded.json<UserSettings>('/api/settings')
    expect(sync.data.notes).toHaveLength(2)
    expect(sync.data.notes.some((note) => note.title === 'Temporary page state')).toBe(false)
    expect(settings.data.appearance.theme).toBe('system')
  })
})
