import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const rootFile = (path: string) => fileURLToPath(new URL(path, import.meta.url))

const PUBLIC_ASSETS = [
  'apple-touch-icon.png',
  'inkstone-logo.svg',
  'manifest.webmanifest',
  'pwa-192x192.png',
  'pwa-512x512.png',
  'pwa-maskable-512x512.png',
] as const

export function inkstonePwa(): Plugin {
  return {
    name: 'inkstone:pwa',
    apply: 'build',
    applyToEnvironment: (environment) => environment.name === 'client',
    generateBundle(_options, bundle) {
      const bundleFiles = Object.values(bundle)
        .map((entry) => entry.fileName)
        .filter((fileName) => !fileName.endsWith('.map'))
      const precache = [...new Set([
        'index.html',
        ...bundleFiles,
        ...PUBLIC_ASSETS,
      ])]
        .sort()
        .map((fileName) => `/${fileName}`)

      const hash = createHash('sha256')
      for (const entry of Object.values(bundle).sort((left, right) =>
        left.fileName.localeCompare(right.fileName))) {
        hash.update(entry.fileName)
        hash.update(entry.type === 'chunk' ? entry.code : entry.source)
      }
      for (const fileName of PUBLIC_ASSETS) {
        hash.update(fileName)
        hash.update(readFileSync(rootFile(`./public/${fileName}`)))
      }

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerSource(`inkstone-shell-${hash.digest('hex').slice(0, 16)}`, precache),
      })
    },
  }
}

function serviceWorkerSource(cacheName: string, precache: string[]): string {
	return `const CACHE_NAME = ${JSON.stringify(cacheName)}
	const PRECACHE_URLS = ${JSON.stringify(precache)}
	const CACHE_META_URL = '/.inkstone-cache-meta'
	const NETWORK_ONLY_EXACT_PATHS = ['/authorize', '/mcp']
	const NETWORK_ONLY_PATH_PREFIXES = ['/api/', '/authorize/', '/mcp/', '/oauth/', '/.well-known/']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(PRECACHE_URLS)
      await cache.put(CACHE_META_URL, new Response(String(Date.now())))
    }),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      const shellKeys = keys.filter((key) => key.startsWith('inkstone-shell-'))
      const previous = await Promise.all(
        shellKeys
          .filter((key) => key !== CACHE_NAME)
          .map(async (key) => {
            const cache = await caches.open(key)
            const installedAt = Number(await (await cache.match(CACHE_META_URL))?.text()) || 0
            return { key, installedAt }
          }),
      )
      previous.sort((left, right) => right.installedAt - left.installedAt)
      await Promise.all(previous.slice(1).map(({ key }) => caches.delete(key)))
      await self.clients.claim()
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
	  if (
	    url.origin !== self.location.origin ||
	    NETWORK_ONLY_EXACT_PATHS.includes(url.pathname) ||
	    NETWORK_ONLY_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
	  ) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match('/index.html')
        return cached || Response.error()
      }),
    )
    return
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)),
  )
})
`
}
