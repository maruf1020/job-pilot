import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { countryTimezone } from '@/lib/domain'
import type { EmailConfig } from '@/lib/settings/schema'

function parseHm(s: string): { h: number; m: number } {
  const [h, m] = s.split(':').map((x) => Number.parseInt(x, 10))
  return { h: h || 0, m: m || 0 }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * Math.max(0, max - min)
}

/**
 * Next datetime inside the send window (in the job's country timezone), at least
 * `minGap..maxGap` minutes after `notBefore`. Purely deterministic apart from the gap.
 */
export function nextSendSlot(cfg: EmailConfig, countryCode: string | null | undefined, notBefore: Date = new Date()): Date {
  const tz = countryTimezone(countryCode)
  const gapMs = randomBetween(cfg.minGapMinutes, cfg.maxGapMinutes) * 60_000
  const earliest = new Date(notBefore.getTime() + gapMs)
  if (cfg.sendImmediately) return earliest
  const days = cfg.sendWindow.days.length ? cfg.sendWindow.days : [1, 2, 3, 4, 5]
  const start = parseHm(cfg.sendWindow.start)
  const end = parseHm(cfg.sendWindow.end)

  // Walk day by day (max 14) in the target timezone.
  const zoned = toZonedTime(earliest, tz)
  for (let i = 0; i < 14; i++) {
    const day = new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate() + i)
    if (!days.includes(day.getDay())) continue
    const windowStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), start.h, start.m, 0, 0)
    const windowEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), end.h, end.m, 0, 0)
    if (i === 0 && zoned >= windowEnd) continue
    const candidate = i === 0 && zoned > windowStart ? zoned : windowStart
    if (candidate <= windowEnd) return fromZonedTime(candidate, tz)
  }
  return earliest
}

/** Spread N sends across the window: each next slot starts after the previous one. */
export function scheduleSequence(cfg: EmailConfig, countryCodes: Array<string | null | undefined>, notBefore: Date = new Date()): Date[] {
  const out: Date[] = []
  let cursor = notBefore
  for (const cc of countryCodes) {
    const slot = nextSendSlot(cfg, cc, cursor)
    out.push(slot)
    cursor = slot
  }
  return out
}
