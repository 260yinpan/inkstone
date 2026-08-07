/** Provides pure Markdown analysis shared by the browser and Worker runtimes. */
import { parseDocument } from 'yaml'
import { truncateText } from './text-utils'


export function stripCodeRegions(text: string): string {
  const lines = text.split('\n')
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const m = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line)
    if (m) {
      const marker = m[1]!
      const ch = marker[0]!
      if (!inFence) {
        inFence = true
        fenceChar = ch
        fenceLen = marker.length
        lines[i] = ''
        continue
      }
      if (ch === fenceChar && marker.length >= fenceLen) {
        inFence = false
        lines[i] = ''
        continue
      }
    }
    if (inFence) {
      lines[i] = ''
      continue
    }
    lines[i] = line.replace(/`+[^`\n]*`+/g, (s) => ' '.repeat(s.length))
  }
  return lines.join('\n')
}

export interface FrontMatterResult {
  body: string
  data: Record<string, unknown>
  raw: string

  lineOffset: number
  errors: string[]
}

const FRONT_MATTER_LIMIT = 64 * 1024
const UTF8_ENCODER = new TextEncoder()


export function parseFrontMatter(text: string): FrontMatterResult {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text
  if (!/^---[ \t]*(?:\r?\n|$)/.test(source)) {
    return { body: source, data: {}, raw: '', lineOffset: 0, errors: [] }
  }

  const lines = source.split(/\r?\n/)
  const separators = source.match(/\r?\n/g) ?? []
  let closing = -1
  let bytes = UTF8_ENCODER.encode(lines[0]!).byteLength
  for (let index = 1; index < lines.length; index++) {
    bytes += UTF8_ENCODER.encode(separators[index - 1] ?? '').byteLength
    bytes += UTF8_ENCODER.encode(lines[index]!).byteLength
    if (bytes > FRONT_MATTER_LIMIT) {
      return {
        body: source,
        data: {},
        raw: '',
        lineOffset: 0,
        errors: ['Front Matter exceeds the 64 KiB safety limit'],
      }
    }
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[index]!)) {
      closing = index
      break
    }
  }
  if (closing < 0) return { body: source, data: {}, raw: '', lineOffset: 0, errors: [] }

  const raw = lines.slice(1, closing).join('\n')
  try {
    const document = parseDocument(raw, {
      prettyErrors: false,
      uniqueKeys: true,
    })
    const errors = document.errors.map((error) => error.message)
    if (errors.length) {
      return {
        body: lines.slice(closing + 1).join('\n'),
        data: {},
        raw,
        lineOffset: closing + 1,
        errors,
      }
    }
    const value = document.toJS({ maxAliasCount: 20 }) as unknown
    const data = isPlainRecord(value) ? value : {}
    if (value != null && !isPlainRecord(value)) {
      errors.push('Front Matter root must be a YAML mapping')
    }
    return {
      body: lines.slice(closing + 1).join('\n'),
      data,
      raw,
      lineOffset: closing + 1,
      errors,
    }
  } catch (error) {
    return {
      body: lines.slice(closing + 1).join('\n'),
      data: {},
      raw,
      lineOffset: closing + 1,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}


export function splitFrontMatter(text: string): { body: string; meta: Record<string, string> } {
  const parsed = parseFrontMatter(text)
  const meta: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value == null) continue
    if (typeof value === 'string') meta[key] = value
    else if (typeof value === 'number' || typeof value === 'boolean') meta[key] = String(value)
    else meta[key] = JSON.stringify(value)
  }
  return { body: parsed.body, meta }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const TAG_RE = /(^|[\s(\uff08[\u3010>\u300c\u300e\uff0c,\u3001;\uff1b])#([\p{L}\p{N}_\-/·]{1,60})(?![\p{L}\p{N}_\-/·])/gu
const TAG_COLLATOR = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })


export function compareTagNames(a: string, b: string): number {
  return TAG_COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

export function sortTagNames(tags: Iterable<string>): string[] {
  return [...tags].sort(compareTagNames)
}


export function extractTags(content: string): string[] {
  const frontMatter = parseFrontMatter(content)
  const safe = stripCodeRegions(frontMatter.body)
  const out = new Map<string, string>()
  const add = (value: string) => {
    const key = value.normalize('NFKC').toLocaleLowerCase()
    if (!out.has(key)) out.set(key, value)
  }
  for (const tag of frontMatterTags(frontMatter.data)) {
    const normalized = tag.replace(/^#/, '').trim()
    if (normalized && normalized.length <= 60 && !/^\d+$/.test(normalized)) add(normalized)
    if (out.size >= 64) return sortTagNames(out.values())
  }
  for (const m of safe.matchAll(TAG_RE)) {
    let tag = m[2]!

    tag = tag.replace(/[.,\uff0c\u3002;\uff1b:\uff1a!\uff01?\uff1f\u3001·/]+$/u, '')
    if (!tag || /^\d+$/.test(tag)) continue
    if (tag.length > 60) continue
    add(tag)
    if (out.size >= 64) break
  }
  return sortTagNames(out.values())
}

function frontMatterTags(data: Record<string, unknown>): string[] {
  const value = data.tags ?? data.tag
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value !== 'string') return []
  return value
    .replace(/^\[|\]$/g, '')
    .split(/[,\s]+/)
    .filter(Boolean)
}

const WIKI_RE = /\[\[([^[\]|\n]{1,400})(?:\|([^[\]\n]{0,200}))?\]\]/g

export interface WikiLink {
  target: string
  alias: string | null
  key: string
}


export function extractWikiLinks(content: string): WikiLink[] {
  const safe = stripCodeRegions(splitFrontMatter(content).body)
  const seen = new Set<string>()
  const out: WikiLink[] = []
  for (const m of safe.matchAll(WIKI_RE)) {
    const target = m[1]!.trim()
    if (!target) continue
    const noteTarget = wikiNoteTarget(target)
    if (!noteTarget) continue
    const key = normalizeLinkKey(noteTarget)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ target, alias: m[2]?.trim() || null, key })
    if (out.length >= 200) break
  }
  return out
}

const ATTACHMENT_REFERENCE_RE =
  /(?:^|[\s(<"'=])\/api\/files\/([0-9a-hjkmnp-tv-z]{26})(?=$|[\s>)\]"'?#])/g


export function extractAttachmentIds(content: string): string[] {
  const safe = stripCodeRegions(splitFrontMatter(content).body)
  const ids = new Set<string>()
  for (const match of safe.matchAll(ATTACHMENT_REFERENCE_RE)) ids.add(match[1]!)
  return [...ids]
}

export function normalizeLinkKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}


export function wikiNoteTarget(target: string): string {
  const value = target.trim()
  if (!value || value.startsWith('#') || value.startsWith('^')) return ''
  const hash = value.indexOf('#')
  return (hash >= 0 ? value.slice(0, hash) : value).trim()
}

const MASK = '\u0000'
const MASK_RE = /\u0000(\d+)\u0000/g

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}


export function replaceTagInContent(content: string, from: string, to: string | null): string {
  const frontMatter = parseFrontMatter(content)
  const hasFrontMatter = frontMatter.lineOffset > 0
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const header = hasFrontMatter ? lines.slice(0, frontMatter.lineOffset) : []
  const body = hasFrontMatter ? lines.slice(frontMatter.lineOffset).join('\n') : normalized
  const rewrittenFrontMatter = hasFrontMatter && frontMatter.errors.length === 0
    ? replaceTagInFrontMatter(header, frontMatter.raw, from, to)
    : header
  const rewrittenBody = replaceInlineTag(body, from, to)
  return [...rewrittenFrontMatter, rewrittenBody].join('\n')
}

function replaceInlineTag(content: string, from: string, to: string | null): string {
  const pattern = new RegExp(
    `(^|[\\s(\uff08\\[\u3010>\u300c\u300e\uff0c,\u3001;\uff1b])#${escapeRegExp(from)}(?![\\p{L}\\p{N}_\\-/·])`,
    'gu',
  )
  const lines = content.split('\n')
  let inFence = false
  let fenceChar = ''
  let fenceLen = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const m = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line)
    if (m) {
      const marker = m[1]!
      if (!inFence) {
        inFence = true
        fenceChar = marker[0]!
        fenceLen = marker.length
        continue
      }
      if (marker[0] === fenceChar && marker.length >= fenceLen) {
        inFence = false
        continue
      }
    }
    if (inFence) continue


    const spans: string[] = []
    const masked = line.replace(/`+[^`\n]*`+/g, (s) => {
      spans.push(s)
      return MASK + String(spans.length - 1) + MASK
    })
    const replaced = masked.replace(pattern, (_s, lead: string) => (to ? `${lead}#${to}` : lead))
    lines[i] = replaced.replace(MASK_RE, (_s, idx: string) => spans[Number(idx)] ?? '')
  }
  return lines.join('\n')
}

function replaceTagInFrontMatter(
  header: string[],
  raw: string,
  from: string,
  to: string | null,
): string[] {
  const document = parseDocument(raw, { prettyErrors: false, uniqueKeys: true })
  if (document.errors.length) return header
  const data = document.toJS({ maxAliasCount: 20 }) as unknown
  if (!isPlainRecord(data)) return header
  const key = Object.prototype.hasOwnProperty.call(data, 'tags')
    ? 'tags'
    : Object.prototype.hasOwnProperty.call(data, 'tag') ? 'tag' : null
  if (!key) return header
  const value = data[key]
  const rewrite = (tag: string) => {
    const hash = tag.trim().startsWith('#') ? '#' : ''
    const name = tag.trim().replace(/^#/, '')
    if (name !== from) return tag
    return to ? `${hash}${to}` : null
  }
  let next: string[] | string | null = null
  if (Array.isArray(value)) {
    const values = value
      .filter((item): item is string => typeof item === 'string')
      .map(rewrite)
      .filter((item): item is string => item !== null)
    if (values.length === value.length && values.every((item, index) => item === value[index])) return header
    next = values.length ? values : null
  } else if (typeof value === 'string') {
    const separator = value.includes(',') ? ', ' : ' '
    const values = frontMatterTags({ [key]: value })
      .map(rewrite)
      .filter((item): item is string => item !== null)
    const joined = values.join(separator)
    if (joined === value) return header
    next = joined || null
  } else {
    return header
  }
  if (next === null) document.delete(key)
  else document.set(key, next)
  const closing = header.at(-1) ?? '---'
  const serialized = document.toString().replace(/\n$/, '')
  return [header[0] ?? '---', ...(serialized ? serialized.split('\n') : []), closing]
}

export function replaceWikiLinkTarget(content: string, from: string, to: string): string {
  const fromKey = normalizeLinkKey(from)
  return content.replace(
    /\[\[([^[\]|\n]{1,400})(\|[^[\]\n]{0,200})?\]\]/g,
    (whole, target: string, alias?: string) => {
      const note = wikiNoteTarget(target)
      if (normalizeLinkKey(note) !== fromKey) return whole
      const fragment = target.slice(note.length)
      return `[[${to}${fragment}${alias ?? ''}]]`
    },
  )
}

export function deriveTitle(content: string, fallback = "Untitled note"): string {
  const { body, meta } = splitFrontMatter(content)
  if (meta.title) return trimTitle(meta.title)
  const safe = stripCodeRegions(body)
  const lines = safe.split('\n')
  for (const line of lines) {
    const h = /^[ \t]{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (h) {
      const t = inlinePlain(h[2]!)
      if (t) return trimTitle(t)
    }
  }
  for (const line of lines) {
    const t = inlinePlain(line.replace(/^[ \t>*+\-]+/, '').replace(/^\d+[.)]\s*/, ''))
    if (t) return trimTitle(t)
  }
  return fallback
}

function trimTitle(t: string): string {
  const clean = t.replace(/\s+/g, ' ').trim()
  return clean.length > 200 ? truncateText(clean, 200) + '…' : clean
}

export function deriveExcerpt(content: string, max = 220): string {
  const plain = toPlainText(content)
  const title = deriveTitle(content, '')
  let text = plain
  if (title && text.startsWith(title)) text = text.slice(title.length)
  text = text.replace(/^[\s\n]+/, '').replace(/\s*\n\s*/g, ' ').trim()
  if (text.length <= max) return text
  return truncateText(text, max).replace(/\s+\S*$/, '') + '…'
}

function inlinePlain(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g, (_s, a: string, b?: string) => b || a)
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/==(.*?)==/g, '$1')
    .replace(/<[^>]{1,200}>/g, '')
    .replace(/`+/g, '')
    .trim()
}


export function toPlainText(md: string): string {
  let t = stripCodeRegions(splitFrontMatter(md).body)
  t = t.replace(/^ {0,3}(?:[-*_][ \t]*){3,}$/gm, '')
  t = t.replace(/^[ \t]{0,3}#{1,6}\s+/gm, '')
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, '')
  t = t.replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/gm, '')
  t = t.replace(/^[ \t]*[-*+][ \t]+/gm, '')
  t = t.replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
  t = t.replace(/^[ \t]*\|.*\|[ \t]*$/gm, (row) =>
    /^[ \t]*\|[\s:|-]+\|[ \t]*$/.test(row) ? '' : row.replace(/\|/g, ' '),
  )
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  t = t.replace(/\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g, (_s, a: string, b?: string) => b || a)
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, ' $1 ')
  t = t.replace(/\$([^$\n]+)\$/g, ' $1 ')
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2')
  t = t.replace(/(\*|_)(.*?)\1/g, '$2')
  t = t.replace(/~~(.*?)~~/g, '$1')
  t = t.replace(/==(.*?)==/g, '$1')
  t = t.replace(/\+\+(.*?)\+\+/g, '$1')
  t = t.replace(/<[^>]{1,300}>/g, '')
  t = t.replace(/^\[\^[^\]]+\]:/gm, '')
  t = t.replace(/\[\^[^\]]+\]/g, '')
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

const CJK_CHAR = /[\u2e80-\u9fff\uf900-\ufaff]/
const CJK_GLOBAL = /[\u2e80-\u9fff\uf900-\ufaff\uff01-\uffe0]/g


export function countText(md: string): { words: number; chars: number } {
  const plain = toPlainText(md)
  let cjk = 0
  for (const ch of plain) if (CJK_CHAR.test(ch)) cjk++
  const latin = plain.match(/[A-Za-z0-9_'’-]+/g)?.length ?? 0
  return { words: cjk + latin, chars: [...md].length }
}


export function segmentCJK(text: string): string {
  return text.replace(CJK_GLOBAL, (c) => ` ${c} `).replace(/\s{2,}/g, ' ')
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 300))
}

export function slugifyHeading(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[\s\u3000]+/g, '-')
      .replace(/[!-/:-@[-`{-~\uff01-\uff5e\uff0c\u3002\u3001\uff1b\uff1a\uff1f\uff08\uff09\u3010\u3011\u300c\u300d\u300e\u300f]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}
