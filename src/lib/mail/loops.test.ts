import { describe, expect, it } from 'vitest'
import { formatRoundLine, loopStatuses, parseRoundLine } from './loops'

const LOG = [
  '2026-11-04 23:08Z | 23:08 Lisbon | L1 | workers apply,search | browser 24h 232 | OK',
  '2026-11-04 23:17 UTC | 23:17 Lisbon | L1 | workers search,apply | OK',
  '2026-11-04 23:17 UTC | 23:17 Lisbon | L2 | funnel@60: 29 lost to unknown country',
  'not a round line',
  '',
].join('\n')

describe('parseRoundLine', () => {
  it('reads both timestamp spellings and keeps the rest of the line as text', () => {
    expect(parseRoundLine('2026-11-04 23:08Z | 23:08 Lisbon | L1 | workers | OK')?.at.toISOString()).toBe(
      '2026-11-04T23:08:00.000Z',
    )
    const r = parseRoundLine('2026-11-04 23:17 UTC | 23:17 Lisbon | L2 | a | b')
    expect(r?.id).toBe('L2')
    expect(r?.text).toBe('a | b')
  })
  it('writes the UTC column and the local time in the configured zone, and reads it back', () => {
    const line = formatRoundLine('L1', 'workers OK', new Date('2026-07-01T12:05:00Z'), 'Europe/Lisbon')
    expect(line).toBe('2026-07-01 12:05 UTC | 13:05 Lisbon | L1 | workers OK')
    expect(parseRoundLine(line)?.at.toISOString()).toBe('2026-07-01T12:05:00.000Z')
    expect(formatRoundLine('L2', 'a', new Date('2026-07-01T12:05:00Z'), 'UTC')).toBe('2026-07-01 12:05 UTC | 12:05 UTC | L2 | a')
  })
  it('rejects other lines', () => {
    expect(parseRoundLine('hello')).toBeNull()
    expect(parseRoundLine('2026-11-04 23:17 UTC | 23:17 Lisbon | L9 | x')).toBeNull()
  })
})

describe('loopStatuses', () => {
  it('uses the last line per loop and marks missing loops late', () => {
    const s = loopStatuses(LOG, new Date('2026-11-04T23:20:00Z'))
    expect(s.map((x) => x.id)).toEqual(['L1', 'L2', 'L3'])
    expect(s[0]).toMatchObject({
      lastRunAt: '2026-11-04T23:17:00.000Z',
      ageMin: 3,
      text: 'workers search,apply | OK',
      late: false,
    })
    expect(s[1]).toMatchObject({ ageMin: 3, late: false })
    expect(s[2]).toMatchObject({ lastRunAt: null, ageMin: null, text: null, late: true })
  })
  it('is late only after twice the interval', () => {
    const at10 = loopStatuses(LOG, new Date('2026-11-04T23:27:00Z'))
    expect(at10[0]).toMatchObject({ ageMin: 10, late: false })
    const at11 = loopStatuses(LOG, new Date('2026-11-04T23:28:00Z'))
    expect(at11[0]).toMatchObject({ ageMin: 11, late: true })
    expect(at11[1].late).toBe(false)
  })
})
