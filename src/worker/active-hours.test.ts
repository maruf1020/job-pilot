import { describe, expect, it } from 'vitest'
import { isActive, nextTransition, parseActiveDays, parseActiveWindow } from './active-hours'

const TZ = 'Asia/Bishkek' // UTC+6, no DST

describe('active hours', () => {
  it('parses hours and day ranges', () => {
    const w = parseActiveWindow('08:00-23:00', '1-5')!
    expect(w.start).toBe(8 * 60)
    expect(w.end).toBe(23 * 60)
    expect([...w.days].sort()).toEqual([1, 2, 3, 4, 5])
    expect([...parseActiveDays('0,6')].sort()).toEqual([0, 6])
    expect(parseActiveDays(undefined).size).toBe(7)
    expect(parseActiveWindow(undefined, undefined)).toBeNull()
    expect(() => parseActiveWindow('23:00-08:00', undefined)).toThrow()
    expect(() => parseActiveWindow('nonsense', undefined)).toThrow()
  })

  it('evaluates the window in the given timezone', () => {
    const w = parseActiveWindow('08:00-23:00', '1-5')!
    // Monday 2026-10-05 09:00 Bishkek = 03:00 UTC
    expect(isActive(w, new Date('2026-10-05T03:00:00Z'), TZ)).toBe(true)
    // Monday 07:59 Bishkek = 01:59 UTC → before start
    expect(isActive(w, new Date('2026-10-05T01:59:00Z'), TZ)).toBe(false)
    // Saturday 2026-10-10 10:00 Bishkek → not an active day
    expect(isActive(w, new Date('2026-10-10T04:00:00Z'), TZ)).toBe(false)
    // no window = always active
    expect(isActive(null, new Date(), TZ)).toBe(true)
  })

  it('finds the next transition', () => {
    const w = parseActiveWindow('08:00-23:00', '1-5')!
    // Monday 22:30 Bishkek (16:30 UTC) → sleeps at 23:00 Bishkek = 17:00 UTC
    expect(nextTransition(w, new Date('2026-10-05T16:30:00Z'), TZ).toISOString()).toBe('2026-10-05T17:00:00.000Z')
    // Friday 23:30 Bishkek (17:30 UTC) → next active Monday 08:00 Bishkek = 2026-10-12T02:00Z
    expect(nextTransition(w, new Date('2026-10-09T17:30:00Z'), TZ).toISOString()).toBe('2026-10-12T02:00:00.000Z')
  })
})
