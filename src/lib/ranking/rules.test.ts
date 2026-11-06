import { describe, expect, it } from 'vitest'
import { buildCandidateContext } from '@/lib/candidate/context'
import { DEFAULT_RANKING, DEFAULT_SEARCH, type SearchConfig } from '@/lib/settings/schema'
import { combineScores, computeRuleScore, inferSeniority, isCoreSoftwareEngineerTitle, isDevTitle, offStackTitle, requiresOtherLanguage, titleAllowed, toAnnualEur, type RuleJobInput } from './rules'

/** A developer search: the profession comes from Settings > Search when no candidate is passed. */
const SOFTWARE: SearchConfig = { ...DEFAULT_SEARCH, profession: 'software', priorityTiers: [['PT'], ['NL', 'DE']] }
const DESIGN: SearchConfig = { ...DEFAULT_SEARCH, profession: 'design', targetTitles: ['Product Designer', 'UX Designer'] }

const profile = { titles: ['Software Engineer', 'Full Stack Engineer'], skills: ['TypeScript', 'React', 'NestJS', 'PostgreSQL'] }

/** Fictional test personas: Alex Rivera (Portuguese citizen in Lisbon) and Sam Okafor (Nigerian citizen, needs sponsorship). */
const alex = buildCandidateContext({
  fullName: 'Alex Rivera',
  pronouns: 'they/them',
  country: 'PT',
  citizenships: ['PT'],
  workAuth: { needsSponsorship: false },
  languageLevels: [
    { name: 'English', level: 'fluent' },
    { name: 'Portuguese', level: 'native' },
  ],
  profession: 'software',
  seniority: ['senior'],
})
const sam = buildCandidateContext({ fullName: 'Sam Okafor', pronouns: 'he/him', country: 'NG', citizenships: ['NG'], workAuth: { needsSponsorship: true }, languageLevels: [{ name: 'English', level: 'fluent' }], profession: 'software', seniority: ['senior'] })

const base: RuleJobInput = {
  title: 'Senior Software Engineer (React/Node)',
  description: 'We use TypeScript, React and Node.js with PostgreSQL. We offer visa sponsorship and a relocation package.',
  countryCode: 'PT',
  remote: false,
  sponsorship: 'yes',
  seniority: 'senior',
  requiredLanguages: [],
  salaryMin: 70000,
  currency: 'EUR',
  postedAt: new Date(),
}

describe('computeRuleScore', () => {
  it('scores an ideal sponsored senior role in a priority country highly', () => {
    const r = computeRuleScore(base, { ...profile, candidate: sam }, DEFAULT_RANKING, SOFTWARE)
    expect(r.excludedReason).toBeUndefined()
    expect(r.score).toBeGreaterThanOrEqual(95)
    const labels = r.breakdown.map((b) => b.label)
    expect(labels).toContain('Sponsorship offered')
    expect(labels).toContain('Priority country (PT)')
    expect(labels).toContain('Title matches target roles')
    expect(labels).toContain('Relocation support mentioned')
    expect(labels).toContain('Seniority: senior')
  })

  it('excludes explicit no-sponsorship roles for a person who needs a visa (or has not said)', () => {
    const r = computeRuleScore({ ...base, sponsorship: 'no' }, { ...profile, candidate: sam }, DEFAULT_RANKING, SOFTWARE)
    expect(r.excludedReason).toMatch(/sponsorship/i)
    expect(r.score).toBe(0)
    expect(computeRuleScore({ ...base, sponsorship: 'no' }, profile, DEFAULT_RANKING, SOFTWARE).excludedReason).toMatch(/sponsorship/i)
  })

  it('ignores sponsorship for a person who may work in the country', () => {
    const no = computeRuleScore({ ...base, sponsorship: 'no' }, { ...profile, candidate: alex }, DEFAULT_RANKING, SOFTWARE)
    expect(no.excludedReason).toBeUndefined()
    const yes = computeRuleScore({ ...base, knownSponsor: true }, { ...profile, candidate: alex }, DEFAULT_RANKING, SOFTWARE)
    const labels = yes.breakdown.map((b) => b.label)
    expect(labels).not.toContain('Sponsorship offered')
    expect(labels).not.toContain('Known sponsor company')
  })

  it('applies the Irish CSEP floor only when a permit is needed there', () => {
    const job = { ...base, countryCode: 'IE', salaryMin: 35000 }
    expect(computeRuleScore(job, { ...profile, candidate: sam }, DEFAULT_RANKING, SOFTWARE).breakdown.some((b) => b.label.includes('CSEP'))).toBe(true)
    expect(computeRuleScore(job, { ...profile, candidate: alex }, DEFAULT_RANKING, SOFTWARE).breakdown.some((b) => b.label.includes('CSEP'))).toBe(false)
  })

  it('penalises a salary below the person minimum', () => {
    const r = computeRuleScore({ ...base, salaryMin: 30000 }, { ...profile, candidate: alex }, { ...DEFAULT_RANKING, minSalaryEur: 45000 }, SOFTWARE)
    expect(r.breakdown.some((b) => b.label.startsWith('Salary below your minimum'))).toBe(true)
  })

  it('excludes roles outside the search area', () => {
    const r = computeRuleScore({ ...base, countryCode: 'US' }, profile, DEFAULT_RANKING, SOFTWARE)
    expect(r.excludedReason).toMatch(/Outside Europe/)
    // A country outside Europe listed in the countries counts as searched.
    const listed = computeRuleScore({ ...base, countryCode: 'US' }, profile, DEFAULT_RANKING, { ...SOFTWARE, countries: [...SOFTWARE.countries, 'US'] })
    expect(listed.excludedReason).toBeUndefined()
  })

  it('respects includeUk', () => {
    const uk = computeRuleScore({ ...base, countryCode: 'GB' }, profile, DEFAULT_RANKING, SOFTWARE)
    expect(uk.excludedReason).toBeUndefined()
    const noUk = computeRuleScore({ ...base, countryCode: 'GB' }, profile, DEFAULT_RANKING, { ...SOFTWARE, includeUk: false })
    expect(noUk.excludedReason).toMatch(/UK/)
  })

  it('penalises languages the person does not speak and levels below theirs', () => {
    const r = computeRuleScore({ ...base, title: 'Junior Developer', seniority: null, requiredLanguages: ['German'] }, { ...profile, candidate: alex }, DEFAULT_RANKING, SOFTWARE)
    const labels = r.breakdown.map((b) => b.label)
    expect(labels).toContain('Requires German')
    expect(labels).toContain('Seniority: junior')
    // Portuguese is one of Alex's languages.
    const pt = computeRuleScore({ ...base, requiredLanguages: ['Portuguese'] }, { ...profile, candidate: alex }, DEFAULT_RANKING, SOFTWARE)
    expect(pt.breakdown.some((b) => b.label.startsWith('Requires'))).toBe(false)
  })

  it('gives no seniority points when the wanted level is unknown', () => {
    const r = computeRuleScore({ ...base, title: 'Junior Developer', seniority: null }, profile, DEFAULT_RANKING, SOFTWARE)
    expect(r.breakdown.some((b) => b.label.startsWith('Seniority'))).toBe(false)
  })

  it('penalises titles outside the field', () => {
    const r = computeRuleScore({ ...base, title: 'Procurement Specialist', seniority: null }, profile, DEFAULT_RANKING, SOFTWARE)
    expect(r.breakdown.some((b) => b.label.includes('not look like a software engineering role'))).toBe(true)
    const ok = computeRuleScore({ ...base, title: 'Technical Lead', seniority: null }, profile, DEFAULT_RANKING, SOFTWARE)
    expect(ok.breakdown.some((b) => b.label.includes('not look like'))).toBe(false)
  })

  it('ranks design jobs for a designer and penalises developer titles', () => {
    const designer = { titles: ['Product Designer', 'UX Designer'], skills: ['Figma', 'User research', 'Prototyping'] }
    const job = { ...base, title: 'Senior Product Designer', description: 'Figma, prototyping and user research for our app.', sponsorship: 'unknown' }
    const d = computeRuleScore(job, designer, DEFAULT_RANKING, DESIGN)
    const labels = d.breakdown.map((b) => b.label)
    expect(labels).toContain('Title matches target roles')
    expect(labels).toContain('Exact target title (your focus)')
    expect(labels).toContain('Skill overlap')
    const dev = computeRuleScore({ ...job, title: 'Backend Engineer', description: 'Go and Kafka.' }, designer, DEFAULT_RANKING, DESIGN)
    expect(dev.breakdown.some((b) => b.label.includes('not look like a design role'))).toBe(true)
    expect(dev.score).toBeLessThan(d.score)
  })

  it('keeps remote roles with unknown country when allowed', () => {
    const r = computeRuleScore({ ...base, countryCode: null, remote: true }, profile, DEFAULT_RANKING, SOFTWARE)
    expect(r.excludedReason).toBeUndefined()
    expect(r.breakdown.some((b) => b.label.startsWith('Remote'))).toBe(true)
  })

  it('caps a title built on another stack for developers only', () => {
    const job = { ...base, title: 'Golang Backend Engineer', knownSponsor: true }
    const r = computeRuleScore(job, { ...profile, candidate: sam }, DEFAULT_RANKING, SOFTWARE)
    expect(r.score).toBeLessThanOrEqual(30)
    expect(r.breakdown.map((b) => b.label).join('|')).toMatch(/another stack \(golang\)/)
    // A Go developer is not capped on a Go title.
    const gopher = computeRuleScore(job, { titles: ['Backend Engineer'], skills: ['Go', 'Kafka'], candidate: sam }, DEFAULT_RANKING, SOFTWARE)
    expect(gopher.breakdown.some((b) => b.label.includes('another stack'))).toBe(false)
  })
})

describe('helpers', () => {
  it('converts monthly and foreign salaries to annual EUR', () => {
    expect(toAnnualEur(5000, 'EUR')).toBe(60000)
    expect(toAnnualEur(50000, 'GBP')).toBe(58500)
    expect(toAnnualEur(null)).toBeNull()
  })
  it('infers seniority from titles', () => {
    expect(inferSeniority('Staff Engineer')).toBe('staff')
    expect(inferSeniority('Lead Software Engineer')).toBe('lead')
    expect(inferSeniority('Software Engineer II')).toBe('mid')
    expect(inferSeniority('Werkstudent Frontend')).toBe('junior')
    expect(inferSeniority('Junior Developer')).toBe('junior')
    expect(inferSeniority('Anything', 'senior')).toBe('senior')
    expect(inferSeniority('Engineering Manager')).toBe('manager')
    // "Manager" is the role itself for a product manager.
    expect(inferSeniority('Senior Product Manager', null, 'product')).toBe('senior')
    expect(inferSeniority('Head of Product', null, 'product')).toBe('manager')
  })
  it('combines rule and llm scores', () => {
    expect(combineScores(80, 60, 0.4)).toBe(72)
    expect(combineScores(80, null, 0.4)).toBe(80)
  })
  it('names the other stack of a title, not the person own', () => {
    expect(offStackTitle('Golang Backend Engineer')).toBe('golang')
    expect(offStackTitle('Senior Backend Engineer (Go)')).toBe('go')
    expect(offStackTitle('Java Developer', ['TypeScript'])).toBe('java')
    expect(offStackTitle('Java Developer', ['Java', 'Spring'])).toBeNull()
    expect(offStackTitle('Full Stack Engineer (Java/React)')).toBeNull()
    expect(offStackTitle('Senior JavaScript Engineer')).toBeNull()
    expect(offStackTitle('Go-to-Market Engineer')).toBeNull()
  })
})

describe('isDevTitle (software profession)', () => {
  it('accepts regular and senior developer titles', () => {
    for (const t of ['Software Engineer', 'Senior Frontend Developer', 'Fullstack TypeScript Engineer', 'Senior Full-Stack Engineer', 'Backend Engineer (Node.js)', 'React Developer', 'Senior Software Engineer - Payments', 'Web Developer', 'Front-End Engineer (m/f/d)', 'Product Engineer', 'Python Developer', 'Senior Java Engineer']) {
      expect(isDevTitle(t), t).toBe(true)
    }
  })
  it('accepts typos, short forms and plain developer titles seen on real postings', () => {
    for (const t of ['Full Stack Developper', 'Full Stack Enginer', 'Fullstack SWE', 'Fullstack React Typescript', 'Senior Developer', 'Senior Developer - Shopify']) {
      expect(isDevTitle(t), t).toBe(true)
    }
    for (const t of ['Senior Developer Advocate', 'Senior Developer & Architect (Data & Systems)', 'Full Stack AI Product Specialist']) {
      expect(isDevTitle(t), t).toBe(false)
    }
  })
  it('rejects lead, staff, manager, architect, junior and non-dev titles by default', () => {
    for (const t of ['Lead Software Engineer', 'Staff Frontend Engineer', 'Engineering Manager', 'Solutions Architect', 'Junior Frontend Developer', 'Frontend Intern', 'Product Manager', 'Data Scientist', 'Head of Engineering', 'Tech Lead, Backend', 'Software Engineer I (New Grad)', 'Entry Level Frontend Developer']) {
      expect(isDevTitle(t), t).toBe(false)
    }
  })
  it('allows lead titles when asked, never managers or architects', () => {
    for (const t of ['Lead Engineer', 'Principal Engineer', 'Tech Lead', 'Technical Lead with React', 'Software Engineering Lead', 'Frontend Lead']) expect(isDevTitle(t, { allowLead: true }), t).toBe(true)
    for (const t of ['Engineering Manager', 'Solutions Architect', 'Sales Lead', 'Lead Teacher', 'Design Engineer']) expect(isDevTitle(t, { allowLead: true }), t).toBe(false)
  })
  it('matches the Software Engineer ladder', () => {
    for (const t of ['Software Engineer', 'Software Engineer II', 'Senior Software Engineer', 'Sr. Software Engineer - Payments', 'Software Engineer | Remote']) expect(isCoreSoftwareEngineerTitle(t), t).toBe(true)
    for (const t of ['Lead Software Engineer', 'Frontend Engineer', 'Software Engineer in Test']) expect(isCoreSoftwareEngineerTitle(t), t).toBe(false)
  })
})

describe('titleAllowed', () => {
  it('lets every title through without rules', () => {
    expect(titleAllowed({}, 'Engineering Manager')).toBe(true)
    expect(titleAllowed({ targetTitlesOnly: true }, 'Office Manager')).toBe(true)
  })
  it('keeps a designer on design titles', () => {
    const rules = { targetTitlesOnly: true }
    for (const t of ['Senior Product Designer', 'UX/UI Designer', 'UX Designer (m/f/d)', 'Lead Product Designer - Payments', 'Visual Designer']) expect(titleAllowed(rules, t, DESIGN), t).toBe(true)
    for (const t of ['Interior Designer', 'Fashion Designer', 'Backend Engineer', 'Design Verification Engineer', 'Account Executive']) expect(titleAllowed(rules, t, DESIGN), t).toBe(false)
  })
  it('keeps a data analyst on data titles', () => {
    const data = { profession: 'data', targetTitles: ['Data Analyst'] }
    for (const t of ['Senior Data Analyst', 'BI Analyst', 'Analytics Engineer', 'Data Scientist']) expect(titleAllowed({ targetTitlesOnly: true }, t, data), t).toBe(true)
    for (const t of ['Data Entry Clerk', 'Frontend Developer', 'Product Designer']) expect(titleAllowed({ targetTitlesOnly: true }, t, data), t).toBe(false)
  })
  it('keeps a developer on developer titles', () => {
    const sw = { profession: 'software', targetTitles: ['Software Engineer'] }
    for (const t of ['Senior Software Engineer', 'Frontend Developer', 'Lead Engineer', 'Engineering Manager']) expect(titleAllowed({ targetTitlesOnly: true }, t, sw), t).toBe(true)
    for (const t of ['Sales Engineer', 'Product Designer', 'Mechanical Engineer']) expect(titleAllowed({ targetTitlesOnly: true }, t, sw), t).toBe(false)
  })
  it('applies the allowed levels; titles without a level always pass', () => {
    const rules = { seniority: ['mid', 'senior'] }
    expect(titleAllowed(rules, 'Senior Product Designer', DESIGN)).toBe(true)
    expect(titleAllowed(rules, 'Product Designer', DESIGN)).toBe(true)
    expect(titleAllowed(rules, 'Junior Product Designer', DESIGN)).toBe(false)
    expect(titleAllowed(rules, 'Lead Software Engineer')).toBe(false)
    expect(titleAllowed({ seniority: ['senior', 'lead'] }, 'Lead Software Engineer')).toBe(true)
  })
})

describe('requiresOtherLanguage', () => {
  it('flags required languages the person does not speak (English assumed without a profile)', () => {
    expect(requiresOtherLanguage(['Ukrainian'])).toBe(true)
    expect(requiresOtherLanguage(['English', 'German'])).toBe(true)
    expect(requiresOtherLanguage(['Slovak'])).toBe(true)
    expect(requiresOtherLanguage(['Portuguese'], alex.languages)).toBe(false)
    expect(requiresOtherLanguage(['Deutsch (C1)'], alex.languages)).toBe(true)
  })
  it('lets English-only postings through', () => {
    expect(requiresOtherLanguage(['English'])).toBe(false)
    expect(requiresOtherLanguage([])).toBe(false)
    expect(requiresOtherLanguage(null)).toBe(false)
  })
})
