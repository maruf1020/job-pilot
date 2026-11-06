import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/email/needs-action', () => ({ needsAction: vi.fn() }))
vi.mock('@/lib/settings/service', () => ({ getSettings: vi.fn() }))

import { lastDays, localDay, mondayOf, perDay, periodTiles, perWeek, type Sent, shiftDay, startOfLocalDay, streaks, topWithOther, viaOf } from './stats'

const TZ = 'Asia/Bishkek' // UTC+6, no daylight saving

describe('local days', () => {
  it('puts an instant on the calendar day of the user, not the UTC one', () => {
    expect(localDay(new Date('2026-10-29T17:59:00Z'), TZ)).toBe('2026-10-29')
    expect(localDay(new Date('2026-10-29T18:00:00Z'), TZ)).toBe('2026-10-30')
  })

  it('finds the instant local midnight starts', () => {
    expect(startOfLocalDay('2026-10-30', TZ).toISOString()).toBe('2026-10-29T18:00:00.000Z')
    expect(startOfLocalDay('2026-10-30', 'UTC').toISOString()).toBe('2026-10-30T00:00:00.000Z')
    // Berlin is UTC+1 after the clocks went back on 25 October.
    expect(startOfLocalDay('2026-10-30', 'Europe/Berlin').toISOString()).toBe('2026-10-29T23:00:00.000Z')
    expect(startOfLocalDay('2026-10-20', 'Europe/Berlin').toISOString()).toBe('2026-10-19T22:00:00.000Z')
  })

  it('does calendar arithmetic on day keys', () => {
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31')
    expect(mondayOf('2026-10-30')).toBe('2026-10-26') // a Friday
    expect(mondayOf('2026-10-26')).toBe('2026-10-26')
    expect(mondayOf('2026-11-01')).toBe('2026-10-26') // a Sunday belongs to the week before
    expect(lastDays(3, '2026-10-01')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01'])
  })
})

const at = (iso: string, via: Sent['via'] = 'agent'): Sent => ({ sentAt: new Date(iso), via })

describe('periodTiles', () => {
  // Friday 30 October 2026, 10:00 in Bishkek.
  const now = new Date('2026-10-30T04:00:00Z')

  it('compares today with yesterday up to the same time', () => {
    const rows = [
      at('2026-10-29T19:00:00Z'), // today 01:00
      at('2026-10-30T03:00:00Z', 'email'), // today 09:00
      at('2026-10-28T20:00:00Z'), // yesterday 02:00
      at('2026-10-29T05:00:00Z'), // yesterday 11:00, after this time of day
    ]
    const today = periodTiles(rows, TZ, now).find((t) => t.key === 'today')!
    expect(today.now).toEqual({ total: 2, agent: 1, manual: 0, email: 1 })
    expect(today.before!.total).toBe(1)
  })

  it('counts the week from Monday and the month from the 1st, against the same stretch before', () => {
    const rows = [
      at('2026-10-25T19:00:00Z'), // Mon 26 Oct 01:00 local: this week
      at('2026-10-25T17:00:00Z'), // Sun 25 Oct 23:00 local: last week, but after Friday 10:00
      at('2026-10-19T19:00:00Z'), // Tue 20 Oct 01:00 local: last week, inside the same stretch
      at('2026-09-30T20:00:00Z', 'manual'), // 1 Oct 02:00 local: this month
      at('2026-09-30T17:00:00Z'), // 30 Sep 23:00 local: last month, after the 30th at 10:00
    ]
    const tiles = periodTiles(rows, TZ, now)
    const week = tiles.find((t) => t.key === 'week')!
    expect(week.now.total).toBe(1)
    // Last week up to Friday 10:00.
    expect(week.before!.total).toBe(1)
    const month = tiles.find((t) => t.key === 'month')!
    expect(month.now.total).toBe(4)
    // September up to the 30th at 10:00: the 23:00 send on the 30th is after that.
    expect(month.before!.total).toBe(0)
    const all = tiles.find((t) => t.key === 'all')!
    expect(all.now).toEqual({ total: 5, agent: 4, manual: 1, email: 0 })
    expect(all.before).toBeNull()
  })
})

describe('streaks and weeks', () => {
  const rows = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-29', '2026-10-30'].map((d) => at(`${d}T06:00:00Z`))
  const days = perDay(rows, TZ)

  it('counts the current run and the best run', () => {
    expect(streaks(days, '2026-10-30')).toEqual({ current: 2, best: 3 })
    // Today has nothing yet: the run up to yesterday still counts.
    expect(streaks(days, '2026-10-31').current).toBe(2)
    expect(streaks(days, '2026-11-01').current).toBe(0)
  })

  it('sums days into Monday weeks', () => {
    const weeks = perWeek(days, '2026-10-30', 2)
    expect(weeks.map((w) => [w.week, w.total])).toEqual([
      ['2026-10-19', 1],
      ['2026-10-26', 4],
    ])
  })
})

describe('small helpers', () => {
  it('reads how it was sent', () => {
    expect(viaOf('agent')).toBe('agent')
    expect(viaOf('manual')).toBe('manual')
    expect(viaOf(null)).toBe('email')
  })

  it('folds the tail into one row', () => {
    const rows = [
      { key: 'a', count: 1 },
      { key: 'b', count: 5 },
      { key: 'c', count: 3 },
    ]
    expect(topWithOther(rows, 2, { key: 'other' })).toEqual([
      { key: 'b', count: 5 },
      { key: 'c', count: 3 },
      { key: 'other', count: 1 },
    ])
    expect(topWithOther(rows, 5, { key: 'other' })).toHaveLength(3)
  })
})
