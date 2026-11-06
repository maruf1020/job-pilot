/**
 * Optional "active hours" for the worker. Outside the window the worker stops the
 * queue and closes its database connection, so a serverless Postgres (Neon) can
 * suspend and stay inside a free plan's compute budget.
 *
 *   WORKER_ACTIVE_HOURS=08:00-23:00   (in TZ)
 *   WORKER_ACTIVE_DAYS=1-5            (0 = Sunday … 6 = Saturday; ranges and commas)
 */

export interface ActiveWindow {
  /** minutes since midnight, inclusive */
  start: number
  /** minutes since midnight, exclusive */
  end: number
  days: Set<number>
}

function parseTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 24 || min > 59) return null
  return h * 60 + min
}

export function parseActiveDays(s: string | undefined): Set<number> {
  const days = new Set<number>()
  if (!s || !s.trim()) return new Set([0, 1, 2, 3, 4, 5, 6])
  for (const part of s.split(',')) {
    const p = part.trim()
    const range = /^(\d)-(\d)$/.exec(p)
    if (range) {
      const a = Number(range[1])
      const b = Number(range[2])
      for (let d = a; d <= b; d++) days.add(d % 7)
    } else if (/^\d$/.test(p)) days.add(Number(p))
  }
  return days
}

/** Returns null when no window is configured (worker always active). */
export function parseActiveWindow(hours: string | undefined, days: string | undefined): ActiveWindow | null {
  if (!hours || !hours.trim()) return null
  const m = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(hours)
  if (!m) throw new Error(`WORKER_ACTIVE_HOURS must look like "08:00-23:00", got "${hours}"`)
  const start = parseTime(m[1])
  const end = parseTime(m[2])
  if (start === null || end === null || start >= end) throw new Error(`WORKER_ACTIVE_HOURS must be a start before an end within one day, got "${hours}"`)
  const parsedDays = parseActiveDays(days)
  if (parsedDays.size === 0) throw new Error(`WORKER_ACTIVE_DAYS has no valid days: "${days}"`)
  return { start, end, days: parsedDays }
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function localParts(date: Date, tz: string): { day: number; minutes: number } {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    formatters.set(tz, f)
  }
  const parts = f.formatToParts(date)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  return { day: day < 0 ? 0 : day, minutes: (hour % 24) * 60 + minute }
}

export function isActive(window: ActiveWindow | null, now: Date, tz: string): boolean {
  if (!window) return true
  const { day, minutes } = localParts(now, tz)
  return window.days.has(day) && minutes >= window.start && minutes < window.end
}

/** The next moment the active/inactive state flips (searched minute by minute, at most 8 days ahead). */
export function nextTransition(window: ActiveWindow, now: Date, tz: string): Date {
  const current = isActive(window, now, tz)
  const start = Math.floor(now.getTime() / 60_000) * 60_000
  for (let i = 1; i <= 8 * 24 * 60; i++) {
    const t = new Date(start + i * 60_000)
    if (isActive(window, t, tz) !== current) return t
  }
  return new Date(start + 8 * 24 * 60 * 60_000)
}
