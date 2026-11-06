import { describe, expect, it } from 'vitest'
import { DEFAULT_SEARCH } from '@/lib/settings/schema'
import type { AppSettings } from '@/lib/settings/schema'
import { expandQueries, planCombos, type Combo, type CursorRow } from './rotation'

const now = new Date('2026-10-01T10:00:00Z')
const days = (n: number) => new Date(now.getTime() - n * 86_400_000)

const combos: Combo[] = [
  { query: 'software engineer', countryCode: 'IE' },
  { query: 'software engineer', countryCode: 'DE' },
  { query: 'react developer', countryCode: 'IE' },
  { query: 'react developer', countryCode: 'DE' },
]

describe('planCombos', () => {
  it('runs never-searched combinations first, then the oldest, in priority order', () => {
    const cursors: CursorRow[] = [
      { query: 'software engineer', country: 'IE', nextPage: 1, lastRunAt: days(1), exhaustedAt: null },
      { query: 'software engineer', country: 'DE', nextPage: 3, lastRunAt: days(2), exhaustedAt: null },
    ]
    const plan = planCombos(combos, cursors, { take: 3, cycleDays: 3, now })
    expect(plan.map((p) => `${p.query}|${p.countryCode}|${p.startPage}|${p.neverRun}`)).toEqual([
      'react developer|IE|1|true',
      'react developer|DE|1|true',
      'software engineer|DE|3|false', // oldest of the already-run ones, continuing from page 3
    ])
  })

  it('lets exhausted combinations rest for cycleDays, but uses them when nothing else is left', () => {
    const cursors: CursorRow[] = combos.map((c, i) => ({ query: c.query, country: c.countryCode!, nextPage: 1, lastRunAt: days(i + 1), exhaustedAt: i < 2 ? days(1) : days(5) }))
    const plan = planCombos(combos, cursors, { take: 3, cycleDays: 3, now })
    // The two exhausted 5 days ago are past their rest and come first (oldest run first).
    expect(plan.slice(0, 2).map((p) => `${p.query}|${p.countryCode}`)).toEqual(['react developer|DE', 'react developer|IE'])
    // Then a resting one fills the remaining slot.
    expect(plan[2].query).toBe('software engineer')
  })
})

describe('expandQueries', () => {
  const settings = { search: { ...DEFAULT_SEARCH, queries: ['software engineer', 'Software Engineer', 'full stack developer'] } } as AppSettings
  it('dedupes base queries and adds profile titles and skill variants when enabled', () => {
    const q = expandQueries(settings, { titles: ['Senior Software Engineer', 'Frontend Engineer'], skills: ['TypeScript', 'React', 'PostgreSQL', 'Rust', 'Docker'], stopSkills: ['Rust'] })
    expect(q.slice(0, 2)).toEqual(['software engineer', 'full stack developer'])
    expect(q).toContain('Senior Software Engineer')
    expect(q).toContain('TypeScript developer')
    expect(q).toContain('React developer')
    expect(q).not.toContain('Rust developer')
    expect(q).not.toContain('Docker developer')
  })
  it('returns only the base queries when variants are off', () => {
    const off = { search: { ...settings.search, rotation: { ...settings.search.rotation, autoVariants: false } } } as AppSettings
    expect(expandQueries(off, { titles: ['X'], skills: ['React'], stopSkills: [] })).toEqual(['software engineer', 'full stack developer'])
  })
})
