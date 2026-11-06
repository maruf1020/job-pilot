import type { SourceId } from '@/lib/domain'
import { matchesAnyTarget, titleInField } from '@/lib/candidate/professions'
import type { Profession } from '@/lib/candidate/context'
import type { SearchConfig } from '@/lib/settings/schema'
import { SourceError } from './types'

const DEFAULT_TIMEOUT_MS = 20_000
const USER_AGENT = 'job-pilot/1.0 (+personal job search; contact via application email)'

export interface FetchJsonOptions {
  source: SourceId
  timeoutMs?: number
  retries?: number
  fetchImpl?: typeof fetch
}

/** fetch → JSON with timeout, one retry on 5xx/network errors, typed SourceError on failure. */
export async function fetchJson<T = unknown>(url: string, init: RequestInit, opts: FetchJsonOptions): Promise<T> {
  const retries = opts.retries ?? 1
  const f = opts.fetchImpl ?? fetch
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    try {
      const res = await f(url, {
        ...init,
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...(init.headers ?? {}) },
      })
      if (res.status === 429 || res.status >= 500) {
        lastError = new SourceError(opts.source, `HTTP ${res.status} from ${new URL(url).host}`, res.status)
        if (attempt < retries) {
          await sleep(750 * (attempt + 1))
          continue
        }
        throw lastError
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new SourceError(opts.source, `HTTP ${res.status} from ${new URL(url).host}: ${text.slice(0, 200)}`, res.status)
      }
      const text = await res.text()
      try {
        return JSON.parse(text) as T
      } catch {
        throw new SourceError(opts.source, `Non-JSON response from ${new URL(url).host}`)
      }
    } catch (err) {
      if (err instanceof SourceError && err.status && err.status < 500 && err.status !== 429) throw err
      lastError = err
      if (attempt < retries) {
        await sleep(750 * (attempt + 1))
        continue
      }
    } finally {
      clearTimeout(timer)
    }
  }
  if (lastError instanceof SourceError) throw lastError
  throw new SourceError(opts.source, lastError instanceof Error ? lastError.message : 'Request failed')
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function parseDate(v: unknown): Date | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v)
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? undefined : d
}

export function asString(v: unknown): string {
  return v == null ? '' : String(v)
}

export function asNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/** Title looks like a software role (the software profession's title check on boards that list every role). */
export const ENGINEERING_TITLE_RE =
  /\b(software|engineer|developer|full[- ]?stack|front[- ]?end|back[- ]?end|typescript|javascript|react|node|web|programmer|devops|sre)\b/i

/** The part of Settings > Search that decides which titles a source keeps. */
export type TitleSearch = Partial<Pick<SearchConfig, 'profession' | 'targetTitles'>> | null | undefined

/**
 * Whether a source keeps a posting with this title (boards that list every role): a title of the
 * person's field (Settings > Search > profession) or one of their target titles. Without a
 * profession (older callers and tests) the software check applies; the open "other" profession
 * keeps every title unless target titles are set.
 */
export function wantedTitle(title: string, search?: TitleSearch): boolean {
  const targets = search?.targetTitles ?? []
  if (targets.length && matchesAnyTarget(title, targets)) return true
  const profession = (search?.profession ?? 'software') as Profession
  if (profession === 'software') return ENGINEERING_TITLE_RE.test(title)
  if (profession === 'other') return !targets.length
  return titleInField(title, profession)
}

/**
 * The category a board's API takes for the person's profession, or null to leave the filter off
 * (the title check above then does the work).
 */
export function boardCategory(board: 'themuse' | 'remotive' | 'jobicy', profession: string | null | undefined): string | null {
  const p = profession ?? 'software'
  const map: Record<typeof board, Partial<Record<string, string>>> = {
    themuse: { software: 'Software Engineering', design: 'Design and UX', data: 'Data and Analytics', product: 'Product Management', marketing: 'Marketing', sales: 'Sales' },
    remotive: { software: 'software-dev', design: 'design', data: 'data', product: 'product', marketing: 'marketing', sales: 'sales-business' },
    jobicy: { software: 'engineering' },
  }
  return map[board][p] ?? null
}
