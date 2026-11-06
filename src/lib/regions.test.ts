import { describe, expect, it } from 'vitest'
import { guessCountry, outsideEurope } from '@/lib/geo'
import { gateReason } from '@/lib/pipeline/quality-gate'
import { prefilterReason } from '@/lib/pipeline/prefilter'
import { computeRuleScore } from '@/lib/ranking/rules'
import { DEFAULT_RANKING, DEFAULT_SEARCH } from '@/lib/settings/schema'
import { isTargetCountry, regionBucket, searchCountries } from './regions'

const desc = 'We are hiring a Senior Software Engineer to build our TypeScript and React platform with Node.js services on AWS. You will design APIs and ship features with the product team.'
const withAll = { ...DEFAULT_SEARCH, outsideEurope: ['CA', 'AU', 'US'] as Array<'CA' | 'AU' | 'US' | 'NZ'> }
const job = (over: Record<string, unknown>) => ({ title: 'Senior Software Engineer', description: desc, companyName: 'Acme', countryCode: null, location: null, remote: false, visaFlag: null, ...over })

describe('countries from the location text', () => {
  it.each([
    ['Toronto, ON', 'CA'],
    ['Vancouver, British Columbia, Canada', 'CA'],
    ['Sydney, New South Wales, Australia', 'AU'],
    ['Melbourne', 'AU'],
    ['Auckland, New Zealand', 'NZ'],
    ['Austin, TX', 'US'],
    ['New York, NY', 'US'],
    ['Cambridge, MA', 'US'],
    ['Remote - US', 'US'],
    ['San Francisco, CA, United States', 'US'],
    ['Berlin, DE', 'DE'],
    ['Dublin or New York', 'IE'],
    ['London, UK; Austin, TX', 'GB'],
    ['Latin America', undefined],
  ])('%s → %s', (input, expected) => {
    expect(guessCountry(input)).toBe(expected)
  })
  it('still names places outside Europe', () => {
    expect(outsideEurope('Toronto, ON')).not.toBeNull()
    expect(outsideEurope('Bangalore, India')).toBe('India')
    expect(outsideEurope('Dublin, Ireland')).toBeNull()
  })
})

describe('regions', () => {
  it('targets Europe by default and the switched-on countries outside it', () => {
    expect(isTargetCountry('DE', DEFAULT_SEARCH)).toBe(true)
    expect(isTargetCountry('US', DEFAULT_SEARCH)).toBe(false)
    expect(isTargetCountry('US', withAll)).toBe(true)
    expect(isTargetCountry('GB', { ...DEFAULT_SEARCH, includeUk: false })).toBe(false)
    expect(searchCountries(withAll)).toEqual(expect.arrayContaining(['IE', 'GB', 'CA', 'AU', 'US']))
    expect(regionBucket('CA')).toBe('CA')
    expect(regionBucket(null, true)).toBe('remote')
  })
})

describe('prefilter outside Europe', () => {
  it('drops every non-European job while the countries are off', () => {
    expect(prefilterReason(job({ location: 'Toronto, ON', description: `${desc} We support relocation to Canada through the Global Talent Stream.` }), DEFAULT_SEARCH).reason).toMatch(/^Outside Europe \(Canada\)/)
  })
  it('keeps Canadian postings that state sponsorship, drops the rest', () => {
    expect(prefilterReason(job({ location: 'Toronto, ON', description: `${desc} We support relocation to Canada through the Global Talent Stream.` }), withAll).reason).toBeNull()
    expect(prefilterReason(job({ location: 'Toronto, ON' }), withAll).reason).toMatch(/does not say the employer sponsors/)
    expect(prefilterReason(job({ location: 'Toronto, ON', description: `${desc} You must be legally eligible to work in Canada.` }), withAll).reason).toMatch(/existing work rights/)
  })
  it('Australia: sponsor wording passes, full working rights does not', () => {
    expect(prefilterReason(job({ countryCode: 'AU', description: `${desc} Visa sponsorship is available for the right candidate.` }), withAll).reason).toBeNull()
    expect(prefilterReason(job({ countryCode: 'AU', description: `${desc} Visa sponsorship is available. Applicants must have full working rights in Australia.` }), withAll).reason).toMatch(/existing work rights/)
  })
  it('USA: only cap-exempt employers that say they sponsor', () => {
    expect(prefilterReason(job({ countryCode: 'US', companyName: 'Stripe', description: `${desc} We sponsor H-1B visas.` }), withAll).reason).toMatch(/universities/)
    expect(prefilterReason(job({ countryCode: 'US', companyName: 'Stanford University', description: `${desc} H-1B sponsorship is available.` }), withAll).reason).toBeNull()
  })
})

describe('ranking and gate outside Europe', () => {
  const profile = { titles: ['Software Engineer'], skills: ['TypeScript', 'React'] }
  const rule = { title: 'Senior Software Engineer', description: desc, countryCode: 'CA', sponsorship: 'yes', postedAt: new Date() }
  it('ranks a switched-on country instead of excluding it', () => {
    expect(computeRuleScore(rule, profile, DEFAULT_RANKING, DEFAULT_SEARCH).excludedReason).toMatch(/Outside Europe/)
    const r = computeRuleScore(rule, profile, DEFAULT_RANKING, withAll)
    expect(r.excludedReason).toBeUndefined()
    expect(r.breakdown.map((b) => b.label).join('|')).toMatch(/Outside Europe, sponsorship stated/)
  })
  const g = { countryCode: 'IE', sponsorship: 'unknown', salaryMin: null, salaryMax: null, currency: null, company: { knownSponsor: false } }
  it('forms: Ireland needs no sponsor sign, the UK and the Netherlands still do', () => {
    expect(gateReason(g, { channel: 'form' })).toBeNull()
    expect(gateReason(g)).toMatch(/No sign of visa sponsorship/)
    expect(gateReason({ ...g, countryCode: 'GB' }, { channel: 'form' })).toMatch(/No sign of visa sponsorship/)
    expect(gateReason({ ...g, countryCode: 'NL' }, { channel: 'form' })).toMatch(/IND/)
  })
  it('outside Europe needs a stated sponsorship on every channel', () => {
    expect(gateReason({ ...g, countryCode: 'CA' }, { channel: 'form' })).toMatch(/only postings that say/)
    expect(gateReason({ ...g, countryCode: 'CA', sponsorship: 'yes' }, { channel: 'form' })).toBeNull()
  })
  it('reads monthly salaries in any currency and checks the new floors', () => {
    expect(gateReason({ ...g, countryCode: 'SE', salaryMax: 40_000, currency: 'SEK' }, { channel: 'form' })).toBeNull()
    expect(gateReason({ ...g, countryCode: 'SE', salaryMax: 30_000, currency: 'SEK' }, { channel: 'form' })).toMatch(/below/)
    expect(gateReason({ ...g, countryCode: 'GB', sponsorship: 'yes', salaryMax: 50_000, currency: 'GBP' }, { channel: 'form' })).toMatch(/going rate/)
    expect(gateReason({ ...g, countryCode: 'AU', sponsorship: 'yes', salaryMax: 70_000, currency: 'AUD' }, { channel: 'form' })).toMatch(/482/)
  })
})
