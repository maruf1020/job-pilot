import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * "Today" for the bot (and the loop log) is the day in the person's own time zone, Settings.timezone
 * (IANA, e.g. "Europe/Lisbon"), whatever time zone the server runs in. Daylight saving is handled by
 * date-fns-tz. An unknown or empty zone falls back to UTC rather than failing.
 */
const DAY_MS = 86_400_000

export const PERIODS = ['today', '24h', '7d', '30d', 'all'] as const
export type Period = (typeof PERIODS)[number]

/** The zone when it is a valid IANA name, else "UTC". */
export function safeTimezone(tz: string | null | undefined): string {
  const z = (tz ?? '').trim()
  if (!z) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z })
    return z
  } catch {
    return 'UTC'
  }
}

/** A short name for labels: "Europe/Lisbon" -> "Lisbon", "America/Argentina/Buenos_Aires" -> "Buenos Aires", "UTC" -> "UTC". */
export function tzLabel(tz: string): string {
  const z = safeTimezone(tz)
  const last = z.split('/').pop() ?? z
  return last.replace(/_/g, ' ')
}

/** Midnight of the local day that contains `now`, as a UTC instant. */
export function localDayStart(now: Date, tz: string): Date {
  const z = safeTimezone(tz)
  return fromZonedTime(`${formatInTimeZone(now, z, 'yyyy-MM-dd')}T00:00:00`, z)
}

/** Start of a period (inclusive), or null for "all time". */
export function periodStart(period: Period, now: Date, tz: string): Date | null {
  switch (period) {
    case 'today':
      return localDayStart(now, tz)
    case '24h':
      return new Date(now.getTime() - DAY_MS)
    case '7d':
      return new Date(now.getTime() - 7 * DAY_MS)
    case '30d':
      return new Date(now.getTime() - 30 * DAY_MS)
    case 'all':
      return null
  }
}

/** "today (Lisbon)", "last 7 days", ... */
export function periodLabel(period: Period, tz: string): string {
  switch (period) {
    case 'today':
      return `today (${tzLabel(tz)})`
    case '24h':
      return 'last 24 h'
    case '7d':
      return 'last 7 days'
    case '30d':
      return 'last 30 days'
    case 'all':
      return 'all time'
  }
}

/** "2026-11-05 14:30" in the given zone. */
export function localStamp(date: Date, tz: string): string {
  return formatInTimeZone(date, safeTimezone(tz), 'yyyy-MM-dd HH:mm')
}

/** "14:30" in the given zone. */
export function localTime(date: Date, tz: string): string {
  return formatInTimeZone(date, safeTimezone(tz), 'HH:mm')
}

let cache: { at: number; tz: string } | null = null

/** Settings.timezone (cached for a minute; the bot asks on every command). UTC when it cannot be read. */
export async function getTimezone(): Promise<string> {
  if (cache && Date.now() - cache.at < 60_000) return cache.tz
  try {
    const { db } = await import('@/lib/db')
    const row = await db.settings.findUnique({ where: { id: 1 }, select: { timezone: true } })
    cache = { at: Date.now(), tz: safeTimezone(row?.timezone) }
  } catch {
    return 'UTC'
  }
  return cache.tz
}
