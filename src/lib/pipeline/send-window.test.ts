import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { describe, expect, it } from 'vitest'
import { DEFAULT_EMAIL } from '@/lib/settings/schema'
import { nextSendSlot, scheduleSequence } from './send-window'

// A Monday-Thursday 08:30-11:30 window, so the weekend roll-over is tested (the default is Monday-Friday 09:00-12:00).
const cfg = { ...DEFAULT_EMAIL, sendWindow: { days: [1, 2, 3, 4], start: '08:30', end: '11:30' }, minGapMinutes: 0, maxGapMinutes: 0 } // deterministic
const TZ = 'Europe/Dublin'
const dublin = (iso: string) => fromZonedTime(iso, TZ)
const local = (d: Date) => {
  const z = toZonedTime(d, TZ)
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')} ${String(z.getHours()).padStart(2, '0')}:${String(z.getMinutes()).padStart(2, '0')} d${z.getDay()}`
}

describe('nextSendSlot', () => {
  it('waits for the window start on an allowed day', () => {
    // Monday 2026-09-28 07:00 Dublin → 08:30 same day
    expect(local(nextSendSlot(cfg, 'IE', dublin('2026-09-28T07:00:00')))).toBe('2026-09-28 08:30 d1')
  })
  it('sends immediately inside the window', () => {
    expect(local(nextSendSlot(cfg, 'IE', dublin('2026-09-29T09:15:00')))).toBe('2026-09-29 09:15 d2')
  })
  it('rolls past the window end and over the weekend', () => {
    // Thursday 12:00 → Friday not allowed (Mon–Thu) → Monday 08:30
    expect(local(nextSendSlot(cfg, 'IE', dublin('2026-10-01T12:00:00')))).toBe('2026-10-05 08:30 d1')
  })
  it('uses the country timezone', () => {
    const d = nextSendSlot(cfg, 'DE', dublin('2026-09-28T07:00:00'))
    const berlin = toZonedTime(d, 'Europe/Berlin')
    expect(`${berlin.getHours()}:${berlin.getMinutes()}`).toBe('8:30')
  })
  it('spreads a sequence after each previous slot', () => {
    const gapCfg = { ...DEFAULT_EMAIL, minGapMinutes: 5, maxGapMinutes: 5 }
    const slots = scheduleSequence(gapCfg, ['IE', 'IE', 'IE'], dublin('2026-09-28T09:00:00'))
    expect(slots[1].getTime() - slots[0].getTime()).toBe(5 * 60_000)
    expect(slots[2].getTime() - slots[1].getTime()).toBe(5 * 60_000)
  })
})
