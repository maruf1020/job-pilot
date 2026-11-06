import { describe, expect, it } from 'vitest'
import { toDraft, toInput } from './draft'
import { DEFAULT_PREFS, firstIncompleteStep, fromEur, missingForFinish, profileInputSchema, STEPS, stepSchema, toDerivePrefs, toEur } from './model'

/** Alex Rivera, the fictional test persona, as a saved CandidateProfile row. */
const alexRow = {
  fullName: 'Alex Rivera',
  email: 'alex.rivera@example.com',
  phoneCountryCode: '+351',
  phone: '912 345 678',
  pronouns: 'they/them',
  addressLine: 'Rua Exemplo 12',
  postalCode: '1000-001',
  city: 'Lisbon',
  country: 'PT',
  timezone: 'Europe/Lisbon',
  citizenships: ['PT'],
  workAuth: { needsSponsorship: false, rightToWork: [], authorizationText: null },
  profession: 'software',
  titles: ['Software Engineer'],
  seniority: ['senior', 'staff-ish'],
  languageLevels: [
    { name: 'English', level: 'fluent' },
    { name: 'Portuguese', level: 'native' },
  ],
  links: { linkedin: 'https://www.linkedin.com/in/alex-rivera' },
  experience: [{ company: 'Northwind Labs', title: 'Engineer', from: '2021', to: null, bullets: ['Built things'] }],
  education: [{ school: 'University of Lisbon', degree: 'BSc Computer Science', year: 2018 }],
  diversity: { gender: null },
  emailVoice: { tone: 'direct', neverMention: [], leadWith: ['TypeScript'], signOff: 'Best,' },
}

describe('onboarding model', () => {
  it('lists ten steps whose fields all exist in the schema', () => {
    expect(STEPS).toHaveLength(10)
    const keys = Object.keys(profileInputSchema.shape)
    for (const s of STEPS) for (const f of s.fields) expect(keys).toContain(f)
  })

  it('accepts a step only with its own fields', () => {
    expect(stepSchema(3).safeParse({ fullName: 'Alex Rivera', email: 'alex@example.com' }).success).toBe(true)
    expect(stepSchema(3).safeParse({ country: 'PT' }).success).toBe(false)
    const r = stepSchema(4).parse({ country: 'pt', citizenships: ['pt'], workAuth: { needsSponsorship: null, rightToWork: [], authorizationText: '' } })
    expect(r.country).toBe('PT')
    expect(r.citizenships).toEqual(['PT'])
    expect(r.workAuth?.authorizationText).toBeNull()
  })

  it('turns empty text into null and checks email and phone code', () => {
    const r = profileInputSchema.parse({ givenName: '  ', email: 'Alex@Example.com', phoneCountryCode: '351' })
    expect(r.givenName).toBeNull()
    expect(r.email).toBe('alex@example.com')
    expect(r.phoneCountryCode).toBe('+351')
    expect(profileInputSchema.safeParse({ email: 'not an email' }).success).toBe(false)
  })

  it('names what is missing before Finish', () => {
    expect(missingForFinish(null, { countries: [] }).map((m) => m.label)).toEqual([
      'Full name',
      'Email',
      'Country you live in',
      'Visa sponsorship answer',
      'Profession',
      'At least one target job title',
      'At least one country to search',
    ])
    expect(missingForFinish(alexRow, { countries: ['PT'] })).toEqual([])
    // "No" is an answer; only null means unanswered.
    expect(missingForFinish({ ...alexRow, workAuth: { needsSponsorship: null } }, { countries: ['PT'] }).map((m) => m.step)).toEqual([4])
  })

  it('resumes at the first step that was never saved', () => {
    expect(firstIncompleteStep(null, { aiKeys: 0, hasResume: false, prefs: DEFAULT_PREFS })).toBe(1)
    expect(firstIncompleteStep(null, { aiKeys: 1, hasResume: false, prefs: DEFAULT_PREFS })).toBe(2)
    expect(firstIncompleteStep({ fullName: 'Alex Rivera', links: {} }, { aiKeys: 0, hasResume: true, prefs: DEFAULT_PREFS })).toBe(4)
    expect(firstIncompleteStep(alexRow, { aiKeys: 1, hasResume: true, prefs: { countries: ['PT'] } })).toBe(10)
  })

  it('turns the where-to-look answers into settings prefs', () => {
    const p = toDerivePrefs({ countries: ['PT', 'ES', 'IE'], firstChoice: ['PT', 'FR'], includeRemote: false, remoteOnly: true, minSalary: 40000 }, 'GBP')
    expect(p.priorityTiers).toEqual([['PT'], ['ES', 'IE']])
    expect(p.includeRemote).toBe(true)
    expect(p.minSalaryEur).toBe(toEur(40000, 'GBP'))
    expect(toDerivePrefs({ ...DEFAULT_PREFS, countries: ['PT'] }, null).priorityTiers).toEqual([])
    expect(fromEur(toEur(50000, 'EUR'), 'EUR')).toBe(50000)
  })
})

describe('profile draft', () => {
  it('round-trips a saved profile through the form', () => {
    const d = toDraft(alexRow)
    expect(d.fullName).toBe('Alex Rivera')
    expect(d.seniority).toEqual(['senior'])
    expect(d.tone).toBe('direct')
    expect(d.education[0].year).toBe('2018')
    const input = profileInputSchema.strict().parse(toInput(d))
    expect(input.country).toBe('PT')
    expect(input.languageLevels).toEqual(alexRow.languageLevels)
    expect(input.workAuth?.needsSponsorship).toBe(false)
    expect(input.experience?.[0]).toMatchObject({ company: 'Northwind Labs', to: null, bullets: ['Built things'] })
    expect(input.diversity?.gender).toBeNull()
  })

  it('fills name and email from the account on a fresh install', () => {
    const d = toDraft(null, { account: { name: 'Alex Rivera', email: 'alex@example.com' } })
    expect(d.fullName).toBe('Alex Rivera')
    expect(d.email).toBe('alex@example.com')
    expect(d.salaryOnlyWhenAsked).toBe(true)
    // Each step's slice validates on its own.
    for (const s of STEPS) if (s.fields.length) expect(stepSchema(s.n).safeParse(toInput(d, s.fields)).success).toBe(true)
  })

  it('reads old "English (fluent)" language strings', () => {
    const d = toDraft({ languages: ['English (fluent)', 'German (B2)'] })
    expect(d.languageLevels).toEqual([
      { name: 'English', level: 'fluent' },
      { name: 'German', level: 'professional' },
    ])
  })
})
