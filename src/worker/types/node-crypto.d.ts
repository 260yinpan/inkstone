
declare module 'node:crypto' {
  interface InkstoneScryptOptions {
    N: number
    r: number
    p: number
    maxmem: number
  }

  export function scrypt(
    password: string,
    salt: Uint8Array,
    keyLength: number,
    options: InkstoneScryptOptions,
    callback: (error: Error | null, derivedKey: Uint8Array) => void,
  ): void
}
