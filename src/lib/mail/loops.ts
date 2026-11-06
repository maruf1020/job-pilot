import { localTime, tzLabel } from '@/lib/telegram/tz'

/**
 * The supervisor loops write one line per round to storage/logs/supervisor-rounds.log:
 * "<UTC> | <local time in Settings.timezone> | L1|L2|L3 | <text>", e.g.
 * "2026-11-04 23:17 UTC | 23:17 Lisbon | L1 | workers OK". The second column is only for people
 * reading the file; parsing uses the UTC column. L1 runs every 5 minutes, L2 every 15, L3 every 30.
 * A loop is late once its last line is older than twice its interval.
 */

export const LOOPS = [
  { id: 'L1', label: 'Loop 1', intervalMin: 5 },
  { id: 'L2', label: 'Loop 2', intervalMin: 15 },
  { id: 'L3', label: 'Loop 3', intervalMin: 30 },
] as const

export type LoopId = (typeof LOOPS)[number]['id']

export interface LoopStatus {
  id: LoopId
  label: string
  intervalMin: number
  /** ISO time of the last round; null when the log has none. */
  lastRunAt: string | null
  ageMin: number | null
  text: string | null
  late: boolean
}

export interface RoundLine {
  id: LoopId
  at: Date
  text: string
}

/** One round line in the stable format above; `tz` is Settings.timezone (IANA). */
export function formatRoundLine(id: LoopId, text: string, at: Date, tz: string): string {
  const utc = `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`
  return `${utc} | ${localTime(at, tz)} ${tzLabel(tz)} | ${id} | ${text.replace(/\r?\n/g, ' ')}`
}

/** One log line, or null when it is not a round line. */
export function parseRoundLine(line: string): RoundLine | null {
  const parts = line.split(' | ')
  if (parts.length < 4) return null
  const t = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})\s*(?:Z|UTC)?$/.exec(parts[0].trim())
  const id = parts[2].trim()
  if (!t || !LOOPS.some((l) => l.id === id)) return null
  const at = new Date(Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5]))
  return { id: id as LoopId, at, text: parts.slice(3).join(' | ').trim() }
}

export function loopStatuses(log: string, now: Date = new Date()): LoopStatus[] {
  const last = new Map<LoopId, RoundLine>()
  for (const line of log.split(/\r?\n/)) {
    const r = parseRoundLine(line)
    // The file is appended in time order, so the last line of a loop wins.
    if (r) last.set(r.id, r)
  }
  return LOOPS.map((l) => {
    const r = last.get(l.id)
    const ageMin = r ? Math.max(0, Math.floor((now.getTime() - r.at.getTime()) / 60_000)) : null
    return {
      id: l.id,
      label: l.label,
      intervalMin: l.intervalMin,
      lastRunAt: r ? r.at.toISOString() : null,
      ageMin,
      text: r?.text ?? null,
      late: ageMin === null || ageMin > l.intervalMin * 2,
    }
  })
}
