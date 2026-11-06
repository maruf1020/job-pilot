import { describe, expect, it } from 'vitest'
import { outsideEurope } from '@/lib/geo'
import { DEFAULT_SEARCH } from '@/lib/settings/schema'
import { fitsStack, mentionsStack, noSponsorshipReason, prefilterReason, yearsRequired } from './prefilter'
import { gateReason, modestAskInCurrency, modestSalaryAsk, parseSalaryExpectation } from './quality-gate'

const desc = 'We are hiring a Senior Software Engineer to build our TypeScript and React platform with Node.js services on AWS. You will design APIs and ship features with the product team.'
const job = (over: Record<string, unknown>) => ({ title: 'Senior Software Engineer', description: desc, countryCode: null, location: null, remote: false, visaFlag: null, ...over })

describe('outside Europe from the location text', () => {
  it('names the place when the location is outside Europe', () => {
    expect(outsideEurope('Boston, MA')).not.toBeNull()
    expect(outsideEurope('Springfield, MA')).not.toBeNull()
    expect(outsideEurope('San Francisco, CA, United States')).not.toBeNull()
    expect(outsideEurope('Gurugram, India')).not.toBeNull()
    expect(outsideEurope('Toronto, ON')).not.toBeNull()
    expect(outsideEurope('Sydney')).not.toBeNull()
    expect(outsideEurope('Remote - US')).not.toBeNull()
  })
  it('keeps European and mixed locations', () => {
    expect(outsideEurope('Dublin, Ireland')).toBeNull()
    expect(outsideEurope('Amsterdam or New York')).toBeNull()
    expect(outsideEurope('Remote (EU)')).toBeNull()
    expect(outsideEurope(null)).toBeNull()
  })
})

describe('prefilter with the location text', () => {
  it('drops jobs outside Europe when the country code is missing', () => {
    expect(prefilterReason(job({ location: 'Austin, TX' }), DEFAULT_SEARCH).reason).toMatch(/^Outside Europe/)
    expect(prefilterReason(job({ location: 'Remote - US' }), DEFAULT_SEARCH).reason).toMatch(/^Outside Europe/)
    expect(prefilterReason(job({ location: 'Bangalore, India' }), DEFAULT_SEARCH).reason).toMatch(/^Outside Europe/)
  })
  it('keeps European jobs', () => {
    expect(prefilterReason(job({ location: 'Dublin, Ireland' }), DEFAULT_SEARCH).reason).toBeNull()
    expect(prefilterReason(job({ countryCode: 'NL', location: 'Amsterdam' }), DEFAULT_SEARCH).reason).toBeNull()
  })
  it('drops postings that refuse sponsorship in their own words', () => {
    expect(noSponsorshipReason('Great role. Please note we are unable to sponsor visas for this position.')).toMatch(/no visa sponsorship/)
    expect(noSponsorshipReason('Candidates must already have the right to work in the UK.')).toMatch(/no visa sponsorship/)
    expect(noSponsorshipReason('Visa sponsorship: No')).toMatch(/no visa sponsorship/)
    expect(noSponsorshipReason('We offer visa sponsorship and relocation support.')).toBeNull()
    expect(noSponsorshipReason('We do not offer visa sponsorship for this role.')).toMatch(/no visa sponsorship/)
    expect(noSponsorshipReason('No visa sponsorship is available.')).toMatch(/no visa sponsorship/)
  })
  it('keeps postings that sponsor, even with right-to-work wording', () => {
    expect(noSponsorshipReason('We do sponsor visas for engineers moving to Dublin.')).toBeNull()
    expect(noSponsorshipReason('Applicants must be authorized to work in Germany. Visa sponsorship is available.')).toBeNull()
    expect(noSponsorshipReason('We hire with or without sponsorship.')).toBeNull()
    expect(noSponsorshipReason('Offers may depend on your authorization under U.S. export laws without sponsorship for an export license.')).toBeNull()
    expect(noSponsorshipReason('Applicants must be authorized to work in the country in which they apply.')).toBeNull()
    expect(noSponsorshipReason('Applicants must be authorized to work in Ireland. No visa support.')).toMatch(/no visa sponsorship/)
    expect(noSponsorshipReason('Applicants must be authorized to work in Ireland.')).toMatch(/no visa sponsorship/)
    expect(prefilterReason(job({ countryCode: 'IE', description: `${desc} We do not sponsor work permits.` }), DEFAULT_SEARCH).reason).toMatch(/no visa sponsorship/)
  })
})

describe('permit gate for automatic applications', () => {
  const base = { countryCode: 'IE', sponsorship: 'likely', salaryMin: null, salaryMax: null, currency: null, company: { knownSponsor: false } }
  it('needs a country', () => {
    expect(gateReason({ ...base, countryCode: null })).toMatch(/Country unknown/)
    expect(gateReason({ ...base, countryCode: null, location: 'Remote' })).toMatch(/Country unknown/)
  })
  it('lets remote-from-anywhere jobs through without a country', () => {
    expect(gateReason({ ...base, countryCode: null, location: 'Remote (Worldwide)' })).toBeNull()
    expect(gateReason({ ...base, countryCode: null, location: 'Home based - Worldwide' })).toBeNull()
    expect(gateReason({ ...base, countryCode: null, location: 'Remote, Global' })).toBeNull()
  })
  it('needs sponsorship evidence in Ireland, the UK and the Netherlands, but not in Germany', () => {
    expect(gateReason({ ...base, sponsorship: 'unknown' })).toMatch(/No sign of visa sponsorship/)
    expect(gateReason({ ...base, sponsorship: 'unknown', company: { knownSponsor: true } })).toBeNull()
    expect(gateReason({ ...base, countryCode: 'DE', sponsorship: 'unknown' })).toBeNull()
  })
  it('Dutch jobs need an IND recognised sponsor', () => {
    expect(gateReason({ ...base, countryCode: 'NL', sponsorship: 'yes' })).toMatch(/IND/)
    expect(gateReason({ ...base, countryCode: 'NL', sponsorship: 'yes', company: { knownSponsor: true } })).toBeNull()
  })
  it('checks the salary floor only when a salary is given', () => {
    expect(gateReason({ ...base, salaryMax: 32_000, currency: 'EUR' })).toMatch(/below the Critical Skills/)
    expect(gateReason({ ...base, salaryMin: 55_000, currency: 'EUR' })).toBeNull()
    expect(gateReason({ ...base, countryCode: 'DE', salaryMax: 3_500, currency: 'EUR' })).toMatch(/below the EU Blue Card/)
    expect(gateReason({ ...base, countryCode: 'GB', sponsorship: 'yes', salaryMax: 38_000, currency: 'GBP' })).toMatch(/below the Skilled Worker/)
    expect(gateReason({ ...base, countryCode: 'GB', sponsorship: 'yes', salaryMax: 60_000, currency: 'GBP' })).toBeNull()
  })
})

describe('salary to enter when a form requires one', () => {
  const job = (countryCode: string, salaryMin: number | null = null, currency: string | null = null) => ({ countryCode, salaryMin, currency })
  // Fictional persona: Alex Rivera (Lisbon) with an expectation of EUR 52,000.
  const alex = { salaryExpectation: '52000', salaryCurrency: 'EUR', salaryOnlyWhenAsked: true }

  it('reads the expectation the person typed, in any common shape', () => {
    expect(parseSalaryExpectation('55000')).toEqual({ amount: 55_000, currency: 'EUR' })
    expect(parseSalaryExpectation('EUR 55,000')).toEqual({ amount: 55_000, currency: 'EUR' })
    expect(parseSalaryExpectation('£60k')).toEqual({ amount: 60_000, currency: 'GBP' })
    expect(parseSalaryExpectation('50-60k', 'CHF')).toEqual({ amount: 50_000, currency: 'CHF' })
    expect(parseSalaryExpectation('4.500 EUR per month')).toEqual({ amount: 54_000, currency: 'EUR' })
    expect(parseSalaryExpectation('Open to discuss')).toBeNull()
    expect(parseSalaryExpectation(null)).toBeNull()
  })

  it('has no built-in figure: no expectation in the profile means no ask', () => {
    expect(modestSalaryAsk(job('GB'))).toBeNull()
    expect(modestSalaryAsk(job('DE'), { salaryExpectation: null, salaryCurrency: null, salaryOnlyWhenAsked: true })).toBeNull()
  })

  it('uses the person\'s own expectation and never goes under the posted minimum', () => {
    expect(modestSalaryAsk(job('DE'), alex)).toEqual({ amount: 52_000, currency: 'EUR', onlyWhenAsked: true })
    expect(modestSalaryAsk(job('DE', 60_000, 'EUR'), alex)).toEqual({ amount: 60_000, currency: 'EUR', onlyWhenAsked: true })
    expect(modestSalaryAsk(job('DE', 40_000, 'EUR'), alex)).toEqual({ amount: 52_000, currency: 'EUR', onlyWhenAsked: true })
    expect(modestSalaryAsk(job('PT'), { ...alex, salaryOnlyWhenAsked: false })?.onlyWhenAsked).toBe(false)
  })

  it('asks in the posting\'s currency when it states one', () => {
    const gbp = modestSalaryAsk(job('GB', 30_000, 'GBP'), alex)
    expect(gbp?.currency).toBe('GBP')
    expect(gbp?.amount).toBeGreaterThan(40_000)
    expect(modestAskInCurrency('USD', { amount: 52_000, currency: 'EUR' })?.amount).toBe(57_000)
    expect(modestAskInCurrency('EUR', { amount: 52_000, currency: 'EUR' })).toEqual({ amount: 52_000, currency: 'EUR' })
    expect(modestAskInCurrency('USD', null)).toBeNull()
  })
})

describe('permit rules only for a candidate who needs sponsorship there', () => {
  const ie = { countryCode: 'IE', sponsorship: 'no', salaryMin: null, salaryMax: 30_000, currency: 'EUR', company: { knownSponsor: false } }
  // Fictional personas: Alex Rivera (citizen of PT, needs sponsorship outside the EU) and Sam Okafor (citizen of NG, needs sponsorship).
  const alex = { citizenships: ['PT'], workAuth: { needsSponsorship: true, rightToWork: [], authorizationText: null } }
  const sam = { citizenships: ['NG'], workAuth: { needsSponsorship: true, rightToWork: [], authorizationText: null } }

  it('skips sponsorship, registers and salary floors for an EU citizen applying in the EU', () => {
    expect(gateReason(ie, { candidate: alex })).toBeNull()
    expect(gateReason({ ...ie, countryCode: 'NL', sponsorship: 'unknown' }, { candidate: alex })).toBeNull()
  })

  it('keeps them for a candidate who needs sponsorship, and when nothing is known', () => {
    expect(gateReason(ie, { candidate: sam })).toMatch(/no visa sponsorship/)
    expect(gateReason({ ...ie, sponsorship: 'likely' }, { candidate: sam })).toMatch(/below the Critical Skills/)
    expect(gateReason(ie)).toMatch(/no visa sponsorship/)
    expect(gateReason({ ...ie, countryCode: 'US' }, { candidate: alex })).toMatch(/no visa sponsorship/)
  })
})

describe('your stack focus for batches', () => {
  const js = ['javascript', 'typescript', 'react', 'node.js', 'next.js']
  it('keeps JavaScript and TypeScript roles', () => {
    expect(mentionsStack('Senior Full Stack Engineer\nWe use TypeScript, React and PostgreSQL.', js)).toBe(true)
    expect(mentionsStack('Backend Engineer\nNode.js services on AWS', js)).toBe(true)
  })
  it('drops other stacks and does not read Java inside JavaScript', () => {
    expect(mentionsStack('Software Engineer (Java) - Store\nSpring Boot, Maven, GraalVM', js)).toBe(false)
    expect(mentionsStack('Backend Engineer\nGo and Kubernetes', ['java'])).toBe(false)
    expect(mentionsStack('Frontend Engineer\nJavaScript everywhere', ['java'])).toBe(false)
  })
  it('drops jobs that list your stack among more of another', () => {
    const sre = 'We run Python and Go services on Kubernetes with Terraform; dashboards in React.'
    expect(fitsStack('Senior Site Reliability Engineer', sre, js)).toBe(false)
    expect(fitsStack('Senior Software Engineer', 'Java 21, Spring Boot and Kotlin; some React on the admin side.', js)).toBe(false)
    expect(fitsStack('Senior Software Engineer', 'TypeScript and React on the front, Node.js and Python behind.', js)).toBe(true)
    expect(fitsStack('Senior React Engineer', sre, js)).toBe(true)
    expect(fitsStack('Backend Engineer', 'Ruby on Rails and Kotlin', [])).toBe(true)
  })
  it('keeps mixed stacks where JavaScript/TypeScript is a real part', () => {
    expect(fitsStack('Software Engineer', 'Go and Python services; TypeScript and React on the web app; Kubernetes.', js)).toBe(true)
    expect(fitsStack('Software Engineer', 'Python, Django and Go; we use some JavaScript.', js)).toBe(false)
  })
  it('reads the years of experience a posting asks for, not the company age', () => {
    expect(yearsRequired('You have 10+ years of professional experience building web apps.')).toBe(10)
    expect(yearsRequired('At least 5 years of experience with React; 8+ years experience preferred.')).toBe(5)
    expect(yearsRequired('3-5 years of hands-on experience')).toBe(3)
    // A company describing its own age is not a requirement (Accesa).
    expect(yearsRequired('a technology company headquartered in Cluj-Napoca, with offices in Oradea and 20 years of experience in turning business challenges into digital products. - 5+ years of professional experience in software development')).toBe(5)
    expect(yearsRequired('We have 15 years of experience in delivering software for banks.')).toBeNull()
    expect(yearsRequired('A company with 25+ years in business.')).toBeNull()
    expect(yearsRequired('No years mentioned')).toBeNull()
  })
  it('matches everything when no stack is set', () => {
    expect(mentionsStack('Anything', [])).toBe(true)
  })
})
