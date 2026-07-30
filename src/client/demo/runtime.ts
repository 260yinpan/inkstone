import { localDb } from '../lib/db'
import { createDemoBackend } from './backend'

let installed = false

export async function installDemoRuntime(): Promise<void> {
  if (installed) return
  installed = true
  await localDb.clear()

  const backend = createDemoBackend()
  const nativeFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(new URL(String(input), location.href), init)
    const url = new URL(request.url)
    return url.origin === location.origin && url.pathname.startsWith('/api/')
      ? backend.fetch(request)
      : nativeFetch(input, init)
  }
}
