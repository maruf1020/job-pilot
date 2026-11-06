import { describe, expect, it } from 'vitest'
import { buildCandidateContext } from '@/lib/candidate/context'
import { deriveSettingsFromProfile } from './derive'
import { DEFAULT_RANKING, DEFAULT_SEARCH, searchConfigSchema, rankingConfigSchema, portalConfigSchema } from './schema'

/** The same per-level merge updateSettings does (service.ts imports the DB client, so it is not loaded here). */
function deepMerge<T>(base: T, patch: unknown): T {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!isObj(patch) || !isObj(base)) return (patch ?? base) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v
  return out as T
}

/** The fictional test persona Alex Rivera (Lisbon, Portuguese citizen), once as a designer and once as a developer. */
const alexRow = {
  fullName: 'Alex Rivera',
  pronouns: 'they/them',
  email: 'alex.rivera@example.com',
  phoneCountryCode: '+351',
  phone: '912 345 678',
  city: 'Lisbon',
  country: 'PT',
  timezone: 'Europe/Lisbon',
  citizenships: ['PT'],
  languageLevels: [
    { name: 'English', level: 'fluent' },
    { name: 'Portuguese', level: 'native' },
  ],
}

const designer = buildCandidateContext({
  ...alexRow,
  profession: 'design',
  titles: ['Product Designer', 'UX Designer'],
  skills: ['Figma', 'User research', 'Prototyping'],
  seniority: ['Senior'],
})

const developer = buildCandidateContext({
  ...alexRow,
  profession: 'software',
  titles: ['Software Engineer', 'Backend Engineer', 'Platform Engineer'],
  skills: ['Python', 'Django', 'PostgreSQL', 'Docker', 'AWS', 'PHP'],
  stopSkills: ['PHP'],
  seniority: ['mid', 'senior'],
})

describe('deriveSettingsFromProfile', () => {
  it('builds a design search for a designer', () => {
    const p = deriveSettingsFromProfile(designer, { countries: ['pt', 'ES', 'NL'], priorityTiers: [['PT'], ['ES']] })
    expect(p.search?.profession).toBe('design')
    expect(p.search?.targetTitles).toEqual(['Product Designer', 'UX Designer'])
    // Two titles are few: the field's usual queries are added after them.
    expect(p.search?.queries?.slice(0, 2)).toEqual(['product designer', 'ux designer'])
    expect(p.search?.queries).toContain('ui designer')
    expect(p.search?.queries?.filter((q) => q === 'product designer')).toHaveLength(1)
    expect(p.search?.excludeTitleKeywords).toEqual(expect.arrayContaining(['interior', 'fashion', 'junior', 'intern']))
    expect(p.search?.countries).toEqual(['PT', 'ES', 'NL'])
    expect(p.search?.priorityTiers).toEqual([['PT'], ['ES']])
    expect(p.search?.includeUk).toBe(false)
    expect(p.ranking?.stackKeywords).toEqual(['figma', 'user research', 'prototyping'])
    expect(p.portal?.targetTitlesOnly).toBe(true)
    expect(p.portal?.seniority).toEqual(['senior'])
    expect(p.portal?.stackFocus).toEqual([])
    expect(p.general?.timezone).toBe('Europe/Lisbon')
  })

  it('zeroes the sponsorship weights for an EU citizen searching the EU', () => {
    const p = deriveSettingsFromProfile(designer, { countries: ['PT', 'ES', 'NL'] })
    expect(p.ranking?.weights?.sponsorshipYes).toBe(0)
    expect(p.ranking?.weights?.sponsorshipLikely).toBe(0)
    expect(p.ranking?.weights?.knownSponsor).toBe(0)
    expect(p.ranking?.weights?.salaryBelowCsep).toBe(0)
    expect(p.email?.eligibilityGate).toBe(false)
  })

  it('keeps the sponsorship weights where a visa is needed (the UK for an EU citizen, or a person who needs sponsorship)', () => {
    const uk = deriveSettingsFromProfile(designer, { countries: ['PT', 'GB'] })
    expect(uk.ranking?.weights?.sponsorshipYes).toBe(DEFAULT_RANKING.weights.sponsorshipYes)
    const sam = buildCandidateContext({ fullName: 'Sam Okafor', pronouns: 'he/him', country: 'NG', citizenships: ['NG'], workAuth: { needsSponsorship: true }, profession: 'design', titles: ['Product Designer'] })
    const p = deriveSettingsFromProfile(sam, { countries: ['NL', 'DE'] })
    expect(p.ranking?.weights?.sponsorshipYes).toBe(DEFAULT_RANKING.weights.sponsorshipYes)
    expect(p.email?.eligibilityGate).toBe(true)
  })

  it('builds a developer search from the profile', () => {
    const p = deriveSettingsFromProfile(developer, { countries: ['PT', 'DE'], remoteOnly: true, minSalaryEur: 50000 })
    expect(p.search?.profession).toBe('software')
    // Three titles: no defaults added.
    expect(p.search?.queries).toEqual(['software engineer', 'backend engineer', 'platform engineer'])
    expect(p.search?.excludeTitleKeywords).toEqual(expect.arrayContaining(['php', 'junior', 'sales engineer']))
    expect(p.ranking?.stackKeywords).toEqual(['python', 'django', 'postgresql', 'docker', 'aws'])
    expect(p.ranking?.minSalaryEur).toBe(50000)
    expect(p.portal?.stackFocus).toEqual(['python', 'django'])
    expect(p.portal?.seniority).toEqual(['mid', 'senior'])
    expect(p.search?.remoteOnly).toBe(true)
    expect(p.search?.includeRemote).toBe(true)
  })

  it('keeps junior titles for a person who looks for junior roles and leaves target words alone', () => {
    const grad = buildCandidateContext({ ...alexRow, profession: 'data', titles: ['Graduate Data Analyst'], seniority: ['junior'] })
    const p = deriveSettingsFromProfile(grad, {})
    expect(p.search?.excludeTitleKeywords).not.toContain('junior')
    expect(p.search?.excludeTitleKeywords).not.toContain('graduate')
    expect(p.search?.countries).toEqual(DEFAULT_SEARCH.countries)
    // Few skills: the field's usual ones rank instead.
    expect(p.ranking?.stackKeywords).toContain('sql')
  })

  it('produces a patch the settings schemas accept', () => {
    const p = deriveSettingsFromProfile(designer, { countries: ['PT'] })
    expect(searchConfigSchema.safeParse(deepMerge(DEFAULT_SEARCH, p.search)).success).toBe(true)
    expect(rankingConfigSchema.safeParse(deepMerge(DEFAULT_RANKING, p.ranking)).success).toBe(true)
    expect(portalConfigSchema.safeParse(deepMerge(portalConfigSchema.parse({}), p.portal)).success).toBe(true)
  })
})
