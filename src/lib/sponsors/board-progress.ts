/**
 * Pure helpers for the "find public job boards" progress panel (no imports, so the browser can use them too):
 * progress, speed, ETA, the estimate of the dialog and the per-ATS and per-method counters.
 */

/** "find" is what the Companies page starts; the others are older runs (and "harvest", which scripts may report). */
export const BOARD_RUN_MODES = ['find', 'sponsors', 'repair', 'all', 'harvest'] as const
export type BoardRunMode = (typeof BOARD_RUN_MODES)[number]

export const BOARD_MODE_LABEL: Record<BoardRunMode, string> = {
  find: 'Find boards',
  sponsors: 'Known sponsors',
  repair: 'Repair failing boards',
  all: 'Every company',
  harvest: 'Bulk harvest',
}

/** What the run is working on right now. */
export type BoardRunPhase = 'repair' | 'find' | 'count'
export const BOARD_PHASE_LABEL: Record<BoardRunPhase, string> = {
  repair: 'Repairing boards that stopped answering',
  find: 'Looking for boards',
  count: 'Counting matching jobs on existing boards',
}

/** Boards the finder can read, in the order the panel shows them. */
export const BOARD_ATS_TYPES = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'personio', 'teamtailor', 'workday', 'bamboohr', 'breezy', 'pinpoint', 'join'] as const

/** The three ways to find a board, in the order each company goes through them. */
export const BOARD_METHODS = ['slug', 'careers', 'gemini'] as const
export type BoardMethodId = (typeof BOARD_METHODS)[number]
export const BOARD_METHOD_LABEL: Record<BoardMethodId, string> = {
  slug: 'Slug guess',
  careers: 'Careers page',
  gemini: 'Gemini',
}

/** Most companies one run may cover (dialog and API). */
export const MAX_COMPANIES_PER_RUN = 100_000

/** Share of finished companies, 0 to 100; a run with an unknown total shows 0. */
export function progressPct(checked: number, total: number): number {
  if (!total || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((checked / total) * 100)))
}

/** Companies checked per minute since the run started; null until there is enough to tell (5 s and one company). */
export function companiesPerMinute(checked: number, startedAt: Date | string | number, now: Date | string | number = Date.now()): number | null {
  const elapsed = new Date(now).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 5000 || checked <= 0) return null
  return (checked / elapsed) * 60_000
}

/** Milliseconds left at the current speed; null when the speed is unknown, 0 when nothing is left. */
export function etaMs(checked: number, total: number, perMinute: number | null): number | null {
  if (total > 0 && checked >= total) return 0
  if (!perMinute || perMinute <= 0 || total <= 0) return null
  return Math.round(((total - checked) / perMinute) * 60_000)
}

/** "about 3 min", "about 1 h 20 min", "under a minute". */
export function formatEta(ms: number | null): string {
  if (ms === null) return 'calculating'
  if (ms <= 0) return 'done'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `about ${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `about ${h} h ${m} min` : `about ${h} h`
}

/** "72 per min": the speed as shown. */
export function formatSpeed(perMinute: number | null): string {
  if (perMinute === null) return 'measuring'
  return `${perMinute >= 10 ? Math.round(perMinute) : perMinute.toFixed(1)} per min`
}

/**
 * Rough cost of a run for the dialog. Per company: slug guesses (10 to 24 requests), its own site (up to 10: home
 * page, careers pages, robots.txt, sitemap) and, when both miss, one Gemini question plus up to 3 checks.
 * Speed is bounded by the politest host (Workable allows about 100 requests a minute), so 20 to 60 companies a
 * minute; the panel then shows the real speed and time left.
 */
export function estimateRun(companies: number): { requests: { min: number; max: number }; minutes: { min: number; max: number } } {
  const n = Math.max(0, Math.floor(companies))
  return { requests: { min: n * 10, max: n * 40 }, minutes: { min: n / 60, max: n / 20 } }
}

function fmtMinutes(m: number): string {
  if (m < 1) return 'a minute'
  if (m < 60) return `${Math.round(m)} min`
  const h = m / 60
  return h < 10 ? `${h.toFixed(1).replace(/\.0$/, '')} h` : `${Math.round(h)} h`
}

/** "30,000 to 150,000 requests, roughly 2.5 h to 7.5 h". */
export function formatRunEstimate(companies: number): string {
  const { requests, minutes } = estimateRun(companies)
  const f = (n: number) => n.toLocaleString('en-US')
  return `${f(requests.min)} to ${f(requests.max)} requests, roughly ${fmtMinutes(minutes.min)} to ${fmtMinutes(minutes.max)}`
}

/** Per-ATS counters as stored in the run's Json column (anything unexpected is ignored). */
export function readAtsCounts(value: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.floor(v)
  }
  return out
}

/** The counters with one more board of this ATS (does not change its input). */
export function bumpAtsCount(counts: Record<string, number>, atsType: string): Record<string, number> {
  return { ...counts, [atsType]: (counts[atsType] ?? 0) + 1 }
}

/** Boards found by one method, and how many of them had matching jobs (and were saved). */
export interface MethodCount {
  found: number
  saved: number
}
export type MethodCounts = Record<BoardMethodId, MethodCount>

export function emptyMethodCounts(): MethodCounts {
  return { slug: { found: 0, saved: 0 }, careers: { found: 0, saved: 0 }, gemini: { found: 0, saved: 0 } }
}

/** Per-method counters as stored in the run's Json column; missing or odd values read as 0. */
export function readMethodCounts(value: unknown): MethodCounts {
  const out = emptyMethodCounts()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const m of BOARD_METHODS) {
    const v = (value as Record<string, unknown>)[m]
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      out[m] = { found: Number.isFinite(o.found) ? Math.max(0, Math.floor(o.found as number)) : 0, saved: Number.isFinite(o.saved) ? Math.max(0, Math.floor(o.saved as number)) : 0 }
    }
  }
  return out
}

/** The counters with one more board found by this method (saved when it had matching jobs). Does not change its input. */
export function bumpMethod(counts: MethodCounts, method: BoardMethodId, saved: boolean): MethodCounts {
  return { ...counts, [method]: { found: counts[method].found + 1, saved: counts[method].saved + (saved ? 1 : 0) } }
}

export function isBoardRunMode(value: string): value is BoardRunMode {
  return (BOARD_RUN_MODES as readonly string[]).includes(value)
}

/** The scope names the API accepts: "failing" is the old name of "repair". */
export function normalizeBoardMode(value: string): BoardRunMode | null {
  if (value === 'failing') return 'repair'
  return isBoardRunMode(value) ? value : null
}

/** The worker writes a heartbeat every 2 s while a run goes; silence for this long means it is not running it. */
export const WORKER_SILENT_AFTER_MS = 30_000

export function workerSilentMs(lastTickAt: Date | string | number, now: Date | string | number): number {
  return Math.max(0, new Date(now).getTime() - new Date(lastTickAt).getTime())
}

export function isWorkerSilent(lastTickAt: Date | string | number, now: Date | string | number): boolean {
  return workerSilentMs(lastTickAt, now) > WORKER_SILENT_AFTER_MS
}
