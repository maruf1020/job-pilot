import { Semaphore } from '@/lib/utils/semaphore'

/**
 * Per-host politeness for board discovery. A run checks dozens of companies at once, and every probe goes to
 * the same handful of ATS hosts, so each host gets its own limit of requests in flight and a minimum gap
 * between request starts. Workable is the slow one (it rate-limits an address with a Cloudflare 1015 after a
 * burst), and any 429 pauses that host for a while.
 */

export interface GateRule {
  /** Requests in flight at the same time. */
  concurrency: number
  /** Minimum gap between two request starts, in ms. */
  minIntervalMs: number
}

/** Hosts that share a limit: every tenant of an ATS is one group ("acme.recruitee.com" and "zed.recruitee.com"). */
const GROUPS = ['workable.com', 'greenhouse.io', 'lever.co', 'ashbyhq.com', 'smartrecruiters.com', 'recruitee.com', 'personio.de', 'personio.com', 'teamtailor.com', 'myworkdayjobs.com', 'join.com', 'bamboohr.com', 'breezy.hr', 'pinpointhq.com'] as const

export const GATE_RULES: Record<string, GateRule> = {
  'workable.com': { concurrency: 1, minIntervalMs: 600 },
  'greenhouse.io': { concurrency: 8, minIntervalMs: 0 },
  'lever.co': { concurrency: 8, minIntervalMs: 0 },
  'ashbyhq.com': { concurrency: 6, minIntervalMs: 0 },
  'smartrecruiters.com': { concurrency: 6, minIntervalMs: 0 },
  'recruitee.com': { concurrency: 8, minIntervalMs: 0 },
  'personio.de': { concurrency: 4, minIntervalMs: 0 },
  'personio.com': { concurrency: 4, minIntervalMs: 0 },
  'teamtailor.com': { concurrency: 4, minIntervalMs: 0 },
  'myworkdayjobs.com': { concurrency: 4, minIntervalMs: 100 },
  'join.com': { concurrency: 2, minIntervalMs: 300 },
  'bamboohr.com': { concurrency: 6, minIntervalMs: 0 },
  'breezy.hr': { concurrency: 6, minIntervalMs: 0 },
  'pinpointhq.com': { concurrency: 6, minIntervalMs: 0 },
  // Companies' own sites (careers pages, robots.txt, sitemaps): many different hosts, so one shared limit.
  other: { concurrency: 24, minIntervalMs: 0 },
}

/** The limit group of a URL: an ATS group, or "other" for any company website. */
export function hostKey(url: string): string {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return 'other'
  }
  for (const g of GROUPS) if (host === g || host.endsWith(`.${g}`)) return g
  return 'other'
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class HostGate {
  private readonly sem: Semaphore
  private nextStart = 0
  private pausedUntil = 0

  constructor(private readonly rule: GateRule) {
    this.sem = new Semaphore(rule.concurrency)
  }

  /** Wait for a slot (and the spacing); call the returned function when the request is done. */
  async acquire(): Promise<() => void> {
    const release = await this.sem.acquire()
    const now = Date.now()
    const start = Math.max(now, this.nextStart, this.pausedUntil)
    this.nextStart = start + this.rule.minIntervalMs
    if (start > now) await sleep(start - now)
    return release
  }

  /** Hold every request to this host back for `ms` (the host said 429). */
  penalize(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms)
  }
}

export interface PoliteFetchOptions {
  /** Per request, counted from when it actually starts (not from when it joined the queue). */
  timeoutMs?: number
  rules?: Record<string, GateRule>
  /** How long a host rests after a 429 without a Retry-After header. */
  penaltyMs?: number
}

/**
 * fetch with per-host gates. The caller's own abort signal is replaced: callers start their timer when they
 * call, which would also count the time spent waiting in the queue and time requests out for no reason.
 */
export function createPoliteFetch(base: typeof fetch = globalThis.fetch, opts: PoliteFetchOptions = {}): typeof fetch {
  const rules = opts.rules ?? GATE_RULES
  const gates = new Map<string, HostGate>()
  const gateFor = (key: string) => {
    let g = gates.get(key)
    if (!g) {
      g = new HostGate(rules[key] ?? rules.other ?? { concurrency: 8, minIntervalMs: 0 })
      gates.set(key, g)
    }
    return g
  }
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const key = hostKey(url)
    const gate = gateFor(key)
    const release = await gate.acquire()
    try {
      const res = await base(input, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) })
      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after'))
        gate.penalize(Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 120_000) : (opts.penaltyMs ?? 20_000))
      }
      return res
    } finally {
      release()
    }
  }
}
