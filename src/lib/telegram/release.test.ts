import { describe, expect, it } from 'vitest'
import { buildCandidateContext } from '@/lib/candidate/context'
import { fitBlurb, forbiddenTopicRegex } from './release'

describe('release fit prompt and banned topics come from the profile', () => {
  // Fictional persona (never a real person).
  const sam = buildCandidateContext({ fullName: 'Sam Okafor', pronouns: 'he/him', city: 'Lagos', country: 'NG', citizenships: ['NG'], profession: 'design', workAuth: { needsSponsorship: true } })
  const profile = { headline: 'Product Designer', yearsExperience: 5, skills: ['Figma', 'user research'], titles: ['Senior Product Designer'], candidate: sam }
  const search = { countries: ['DE', 'NL'], includeUk: true, includeRemote: true, remoteOnly: false, outsideEurope: [] as Array<'CA' | 'AU' | 'US' | 'NZ'> }

  it('describes the candidate, their regions and their sponsorship need', () => {
    const b = fitBlurb(profile, { search })
    expect(b).toContain('a designer, Product Designer')
    expect(b).toContain('Lives in Lagos, Nigeria')
    expect(b).toContain('Germany, Netherlands, United Kingdom, or fully remote roles')
    expect(b).toMatch(/Needs employer visa sponsorship/)
    expect(b).not.toMatch(/JavaScript|TypeScript|Europe \(EU/)
    const noSponsor = fitBlurb({ ...profile, candidate: { ...sam, workAuth: { ...sam.workAuth, needsSponsorship: false } } }, { search: { ...search, remoteOnly: true } })
    expect(noSponsor).not.toMatch(/sponsorship/)
    expect(noSponsor).toContain('fully remote roles only')
  })

  it('builds the banned-topic check from the never-mention list only', () => {
    expect(forbiddenTopicRegex([])).toBeNull()
    const re = forbiddenTopicRegex(['crypto trading', 'C++'])!
    expect(re.test('I did some Crypto  trading')).toBe(true)
    expect(re.test('Wrote C++ engines')).toBe(true)
    expect(re.test('React and Node.js')).toBe(false)
  })
})
