import { describe, expect, it } from 'vitest'
import { buildCandidateContext, fillPlaceholders, hasRightToWork, identityFacts, internationalPhone, nationalDigits, needsSponsorshipFor, pronounWords, scrubPersonal, splitName, workRightsSentence } from './context'

const alex = buildCandidateContext({
  fullName: 'Alex Rivera',
  email: 'alex.rivera@example.com',
  phoneCountryCode: '+351',
  phone: '912 345 678',
  city: 'Lisbon',
  country: 'PT',
  citizenships: ['PT'],
  pronouns: 'they/them',
  workAuth: { needsSponsorship: false, rightToWork: [] },
  languageLevels: [
    { name: 'English', level: 'fluent' },
    { name: 'Portuguese', level: 'native' },
  ],
})
const sam = buildCandidateContext({ fullName: 'Sam Okafor', pronouns: 'he/him', city: 'Lagos', country: 'NG', citizenships: ['NG'], workAuth: { needsSponsorship: true }, phoneCountryCode: '+234', phone: '803 555 0199' })

describe('candidate context', () => {
  it('builds name parts, phone and location', () => {
    expect(alex.givenName).toBe('Alex')
    expect(alex.familyName).toBe('Rivera')
    expect(alex.phoneIntl).toBe('+351 912 345 678')
    expect(alex.phoneNational).toBe('912345678')
    expect(alex.location).toBe('Lisbon, Portugal')
    expect(alex.he).toBe('they')
    expect(sam.he).toBe('he')
    expect(splitName('Ana Maria Costa')).toEqual({ given: 'Ana Maria', family: 'Costa' })
    expect(internationalPhone('+44', '07700 900123')).toBe('+44 7700 900123')
    expect(nationalDigits('+44', '+44 7700 900123')).toBe('7700900123')
    expect(pronounWords('she/her').his).toBe('her')
  })

  it('knows where the person may work', () => {
    expect(hasRightToWork(alex, 'DE')).toBe(true) // EU free movement
    // Alex said they never need sponsorship, so outside the EU too the answer follows that.
    expect(hasRightToWork(alex, 'GB')).toBe(true)
    expect(needsSponsorshipFor(sam, 'DE')).toBe(true)
    expect(hasRightToWork(sam, 'NG')).toBe(true)
    expect(workRightsSentence(sam, 'NL')).toMatch(/sponsorship/)
    expect(workRightsSentence(alex, 'DE')).toMatch(/does not need|do not need/)
    expect(hasRightToWork(buildCandidateContext({ fullName: 'X' }), 'DE')).toBeNull()
  })

  it('lists identity facts without empty answers', () => {
    const facts = identityFacts(alex).join('\n')
    expect(facts).toMatch(/Alex Rivera/)
    expect(facts).toMatch(/\+351 912 345 678/)
    expect(facts).not.toMatch(/undefined|null/)
  })

  it('scrubs personal values as whole words and fills them back for another person', () => {
    const lesson = 'Type Alex in First name, Rivera in Last name, phone +351 912 345 678, city Lisbon; Samsung and Alexandria stay; posted 2026-10-29; mail alex.rivera@example.com'
    const scrubbed = scrubPersonal(lesson, alex)
    expect(scrubbed).toContain('{givenName} in First name')
    expect(scrubbed).toContain('{familyName} in Last name')
    expect(scrubbed).toContain('phone {phone}')
    expect(scrubbed).toContain('city {city}')
    expect(scrubbed).toContain('Alexandria')
    expect(scrubbed).toContain('2026-10-29')
    expect(scrubbed).toContain('{email}')
    expect(scrubbed).not.toMatch(/Rivera|912 345|Lisbon/)
    const forSam = fillPlaceholders(scrubbed, sam)
    expect(forSam).toContain('Sam in First name')
    expect(forSam).toContain('+234 803 555 0199')
    expect(forSam).toContain('city Lagos')
    // A short name never eats part of a longer word.
    expect(scrubPersonal('Samsung Galaxy', sam)).toBe('Samsung Galaxy')
  })
})
