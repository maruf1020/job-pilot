import { ageBracketWords, dateInFormat, earliestStartDate, hasAddressParts, hasPhoneCountryPicker, nationalNumber, resolveStandard, rightToWorkOption, signatureDate, sponsorshipOption, wrongDialCode, type StandardContext } from './standard'
import type { ScannedField } from './types'
import { describe, expect, it } from 'vitest'
import { alex, sam } from './__fixtures__/personas'
import { declineOption, matchOption, normalizeQuestion, rangeOption, similarity, splitName, yesNo } from './match'

/** A StandardContext whose answer bank holds `std` (no candidate unless given). */
function makeCtx(std: Record<string, string>, over: Partial<StandardContext> = {}): StandardContext {
  return {
    bank: { rows: [], std: (k) => std[k.replace(/^std:/, '')] ?? null, lookup: () => null },
    email: 'alex.rivera@example.com',
    fullName: 'Alex Rivera',
    yearsExperience: 7,
    coverLetter: null,
    resumePath: 'cv.pdf',
    coverLetterPath: null,
    coverLetterEverywhere: false,
    ...over,
  }
}

const opt = (labels: string[]) => labels.map((label) => ({ label, key: label }))

describe('question normalisation', () => {
  it('drops asterisks, required markers and punctuation', () => {
    expect(normalizeQuestion('Will you require visa sponsorship?*')).toBe('will you require visa sponsorship')
    expect(normalizeQuestion('LinkedIn Profile (optional)')).toBe('linkedin profile')
  })
  it('scores similar questions high', () => {
    expect(similarity('Do you require visa sponsorship?', 'Will you require visa sponsorship')).toBeGreaterThan(0.6)
    expect(similarity('What is your notice period?', 'Desired salary')).toBe(0)
  })
})

describe('option matching', () => {
  const yesNoOpts = ['Yes', 'No']
  it('matches exact and case-insensitive', () => {
    expect(matchOption('yes', yesNoOpts)).toBe('Yes')
    expect(matchOption('No', yesNoOpts)).toBe('No')
  })
  it('prefers the shortest option that starts with the answer', () => {
    expect(matchOption('Yes', ['Yes, I will need sponsorship later', 'Yes', 'No'])).toBe('Yes')
    expect(matchOption('Portugal', ['Poland', 'Portugal (+351)', 'Qatar'])).toBe('Portugal (+351)')
  })
  it('returns null when nothing fits', () => {
    expect(matchOption('Purple', ['Yes', 'No'])).toBeNull()
  })
  it('finds decline options for diversity questions', () => {
    expect(declineOption(['Male', 'Female', 'Decline To Self Identify'])).toBe('Decline To Self Identify')
    expect(declineOption(['Man', 'Woman', 'I prefer not to say'])).toBe('I prefer not to say')
    expect(declineOption(['Yes', 'No'])).toBeNull()
  })
  it('picks numeric ranges', () => {
    expect(rangeOption(5.5, ['0-2 years', '3-5 years', '5-7 years', '8+ years'])).toBe('5-7 years')
    expect(rangeOption(5.5, ['Less than 3', '3 or more'])).toBe('3 or more')
    expect(rangeOption(5, ['1', '2', '5', '10'])).toBe('5')
  })
  it('finds yes/no options in several languages', () => {
    expect(yesNo(['Ja', 'Nein'], true)).toBe('Ja')
    expect(yesNo(['Oui', 'Non'], false)).toBe('Non')
  })
})

describe('names', () => {
  it('keeps everything but the last word as the first name', () => {
    expect(splitName('Alex Rivera Costa')).toEqual({ first: 'Alex Rivera', last: 'Costa' })
  })
})

describe('start date for date fields', () => {
  const now = new Date('2026-10-25T04:00:00Z')
  it('is the notice period out, plus visa time when the job needs sponsorship, on the 1st of a month', () => {
    expect(earliestStartDate({ earliestStart: null, noticePeriod: '2 months' }, { now })).toBe('2027-01-01')
    expect(earliestStartDate({ earliestStart: null, noticePeriod: '2 months' }, { now, needsVisa: true })).toBe('2027-03-01')
    expect(earliestStartDate({ earliestStart: '1 month', noticePeriod: '3 months' }, { now })).toBe('2026-12-01')
  })
  it('keeps a saved future date, starts a week out when available immediately', () => {
    expect(earliestStartDate({ earliestStart: '2027-01-15', noticePeriod: null }, { now })).toBe('2027-01-15')
    expect(earliestStartDate({ earliestStart: 'Immediately', noticePeriod: null }, { now })).toBe('2026-11-01')
  })
  it('is unknown without an answer in the profile', () => {
    expect(earliestStartDate({ earliestStart: null, noticePeriod: null }, { now })).toBeNull()
    expect(earliestStartDate({ earliestStart: 'when we agree', noticePeriod: null }, { now })).toBeNull()
  })
})

describe('phone number when the form picks the country code itself', () => {
  it('keeps only the national number', () => {
    expect(nationalNumber('+351912345678')).toBe('912345678')
    expect(nationalNumber('+351 912-345-678')).toBe('912345678')
    expect(nationalNumber('+44 7911 123456')).toBe('7911123456')
    // The person's own dial code wins over the table.
    expect(nationalNumber('+234 802 000 0000', '+234')).toBe('8020000000')
  })
  it('sees a dial-code picker', () => {
    const field = (over: Partial<ScannedField>): ScannedField => ({ key: 'k', kind: 'text', label: '', name: '', id: '', placeholder: '', required: false, value: '', options: [], accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: '', ...over })
    expect(hasPhoneCountryPicker([field({ kind: 'combobox', label: 'Country', value: '+351' }), field({ kind: 'tel', label: 'Phone' })])).toBe(true)
    expect(hasPhoneCountryPicker([field({ kind: 'combobox', label: 'Country Phone Code' })])).toBe(true)
    expect(hasPhoneCountryPicker([field({ kind: 'select', label: 'Phone prefix', value: 'Spain (+34)' })])).toBe(true)
    expect(wrongDialCode(field({ kind: 'select', label: 'Phone prefix', value: 'Spain (+34)' }), '+351912345678', 'Portugal')).toBe(true)
    expect(wrongDialCode(field({ kind: 'select', label: 'Phone prefix', value: 'Portugal (+351)' }), '+351912345678', 'Portugal')).toBe(false)
    expect(wrongDialCode(field({ kind: 'text', label: 'Phone', value: '+34 600' }), '+351912345678', 'Portugal')).toBe(false)
    expect(hasPhoneCountryPicker([field({ kind: 'combobox', label: 'Country', options: [{ label: 'Germany', key: 'a' }] }), field({ kind: 'tel', label: 'Phone' })])).toBe(false)
  })
})

describe('address and citizenship rules', () => {
  const STD: Record<string, string> = { address_line1: 'Rua Exemplo 12', city: 'Lisbon', postal_code: '1000-001', country: 'Portugal', nationality: 'Portuguese', requires_sponsorship: 'Yes', veteran: 'No' }
  const ctx = (over: Partial<StandardContext> = {}) => makeCtx(STD, over)
  const field = (over: Partial<ScannedField>): ScannedField => ({ key: 'k', kind: 'text', label: '', name: '', id: '', placeholder: '', required: true, value: '', options: [], accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: '', ...over })

  it('answers a plain Location box with where the person lives, not a job country (Personio)', () => {
    expect(resolveStandard(field({ label: 'Location', name: 'location' }), ctx({ jobCountry: 'Ireland', jobLocation: 'Dublin, Ireland' }))).toMatchObject({ value: 'Lisbon, Portugal' })
  })

  it('works out the age from the date of birth', () => {
    const c = ctx({ bank: { rows: [], std: (k) => (k.replace(/^std:/, '') === 'date_of_birth' ? '1990-03-15' : null), lookup: () => null } })
    const born = new Date('1990-03-15')
    const now = new Date()
    const age = now.getFullYear() - 1990 - (now < new Date(now.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0)
    expect(resolveStandard(field({ label: 'Age' }), c)).toMatchObject({ value: String(age) })
    expect(resolveStandard(field({ label: 'Birthday', kind: 'date' }), c)).toMatchObject({ type: 'value' })
  })

  it('takes a box labelled only by its file formats for the CV (Eightfold)', () => {
    expect(resolveStandard(field({ kind: 'file', label: 'Accepted file format: docx or pdf', required: false }), ctx())).toMatchObject({ type: 'file', source: 'resume' })
    expect(resolveStandard(field({ kind: 'file', label: 'Application questions', required: false }), ctx())).toMatchObject({ type: 'skip' })
  })

  it('answers a notice-period list from the saved notice period', () => {
    const c = ctx({ bank: { rows: [], std: (k) => (k.replace(/^std:/, '') === 'notice_period' ? '2 months' : null), lookup: () => null } })
    expect(resolveStandard(field({ kind: 'combobox', label: 'What is your notice period?' }), c)).toMatchObject({ value: '2 months' })
    expect(resolveStandard(field({ kind: 'combobox', label: 'What is your notice period?', options: opt(['Immediately', '1 month', '2 months', '3 months']) }), c)).toMatchObject({ value: '2 months' })
    expect(resolveStandard(field({ kind: 'combobox', label: 'What is your notice period?', options: opt(['Immediately available', '1-4 weeks', '1-2 months', '2-3 months', '3+ months']) }), c)).toMatchObject({ type: 'value' })
    expect(resolveStandard(field({ kind: 'select', label: 'Notice period', options: opt(['Less than 30 days', '30-60 days', '60-90 days', 'More than 90 days']) }), c)).toMatchObject({ type: 'value' })
  })

  it('puts the whole name in a Name & Surname box (NoFluffJobs)', () => {
    expect(resolveStandard(field({ label: 'Name & Surname' }), ctx())).toMatchObject({ value: 'Alex Rivera' })
    expect(resolveStandard(field({ label: 'First and last name' }), ctx())).toMatchObject({ value: 'Alex Rivera' })
  })

  it('answers a salary box in the currency it names, not the job country currency (Holepunch)', () => {
    const r = resolveStandard(field({ kind: 'number', label: 'What is your expected salary? (annual USD)' }), ctx({ salaryAsk: { amount: 180000, currency: 'PLN' } }))
    expect(r).toMatchObject({ type: 'value' })
    const n = Number((r as { value: string }).value)
    // 180,000 PLN converted, not 180,000 typed as dollars.
    expect(n).toBeGreaterThan(30000)
    expect(n).toBeLessThan(70000)
  })

  it('gives LinkedIn numeric text boxes a plain number (Street Smash Burgers)', () => {
    const r = resolveStandard(field({ kind: 'text', id: 'single-line-text-form-component-123-numeric', label: 'What is your expected salary?' }), ctx({ salaryAsk: { amount: 50000, currency: 'EUR' } }))
    expect(r).toMatchObject({ type: 'value', value: '50000' })
  })

  it('gives a lone address box the whole address', () => {
    const f = field({ label: 'Address', hint: 'Please include your full home address including Area/State and Postcode.' })
    expect(resolveStandard(f, ctx())).toEqual({ type: 'value', value: 'Rua Exemplo 12, Lisbon 1000-001, Portugal', source: 'bank' })
  })
  it('gives only the street when the form asks for city and postcode too', () => {
    const fields = [field({ label: 'Address' }), field({ label: 'City' }), field({ label: 'Postcode' })]
    expect(hasAddressParts(fields)).toBe(true)
    expect(resolveStandard(fields[0], ctx({ addressHasParts: true }))).toMatchObject({ type: 'value', value: 'Rua Exemplo 12' })
  })
  it('reads the address from the profile when the answer bank has no row', () => {
    const c = makeCtx({}, { candidate: alex() })
    expect(resolveStandard(field({ label: 'Address' }), c)).toMatchObject({ value: 'Rua Exemplo 12, Lisbon 1000-001, Portugal' })
    expect(resolveStandard(field({ label: 'Postal code' }), c)).toMatchObject({ value: '1000-001' })
    expect(resolveStandard(field({ label: 'Phone number', kind: 'tel' }), c)).toMatchObject({ value: '+351 912 345 678' })
    expect(resolveStandard(field({ label: 'Phone number', kind: 'tel' }), { ...c, phoneHasCountryPicker: true })).toMatchObject({ value: '912345678' })
  })
  it('keeps "how did you find it" inside an essay away from the how-did-you-hear answer', () => {
    const essay = field({ kind: 'textarea', label: "Describe the hardest bug you've tracked down in code you didn't write or control (a third-party script, a browser, framework internals). What was the actual root cause, how did you find it, and what fix shipped?" })
    expect(resolveStandard(essay, ctx())).toBeNull()
    const heard = field({ kind: 'text', label: 'How did you hear about this job?' })
    expect(resolveStandard(heard, ctx())).toMatchObject({ type: 'value' })
  })
  it('answers how-did-you-hear from the profile first, then the usual online entries', () => {
    const f = field({ kind: 'select', label: 'How did you hear about us?', options: opt(['Referral', 'LinkedIn', 'Job board', 'Other']) })
    expect(resolveStandard(f, makeCtx({}, { candidate: alex() }))).toMatchObject({ value: 'LinkedIn' })
    expect(resolveStandard(f, makeCtx({}, { candidate: sam() }))).toMatchObject({ value: 'Job board' })
  })
  it('answers sponsorship questions that mention work authorization as sponsorship questions', () => {
    const yn = opt(['Yes', 'No'])
    const c = ctx()
    expect(resolveStandard(field({ kind: 'combobox', label: "Will you require Elastic's sponsorship to continue or extend your work authorization status?", options: yn }), c)).toMatchObject({ value: 'Yes' })
    expect(resolveStandard(field({ kind: 'combobox', label: 'Are you legally authorized to work in the country in which you are applying?', options: yn }), c)).toMatchObject({ value: 'No' })
    expect(resolveStandard(field({ kind: 'buttons', label: 'Are you authorized to work in the United States without future visa sponsorship?', options: yn }), c)).toMatchObject({ value: 'No' })
    expect(resolveStandard(field({ kind: 'radio', label: 'Are you currently authorized to work in the country where this position is located, without requiring sponsorship?', options: yn }), c)).toMatchObject({ value: 'No' })
    expect(resolveStandard(field({ kind: 'radio', label: 'Do you now or will you in the future need sponsorship for employment visa status?', options: yn }), c)).toMatchObject({ value: 'Yes' })
  })
  it('flips the work-rights answers between someone who needs sponsorship and an EU citizen in the EU', () => {
    const yn = opt(['Yes', 'No'])
    const auth = field({ kind: 'radio', label: 'Are you legally authorized to work in Germany?', options: yn })
    const spons = field({ kind: 'radio', label: 'Will you now or in the future require visa sponsorship?', options: yn })
    const alexDe = makeCtx({}, { candidate: alex(), jobCountryCode: 'DE', jobCountry: 'Germany' })
    const samDe = makeCtx({}, { candidate: sam(), jobCountryCode: 'DE', jobCountry: 'Germany' })
    expect(resolveStandard(auth, alexDe)).toMatchObject({ value: 'Yes' })
    expect(resolveStandard(spons, alexDe)).toMatchObject({ value: 'No' })
    expect(resolveStandard(auth, samDe)).toMatchObject({ value: 'No' })
    expect(resolveStandard(spons, samDe)).toMatchObject({ value: 'Yes' })
    // Outside the EU, Alex needs sponsorship too.
    expect(resolveStandard(spons, makeCtx({}, { candidate: alex(), jobCountryCode: 'US' }))).toMatchObject({ value: 'Yes' })
    // Status lists and free text follow the same truth.
    const eu = field({ kind: 'select', label: 'Work authorisation status', options: opt(['EU/EEA citizen', 'Non-EU citizen requiring sponsorship']) })
    expect(resolveStandard(eu, alexDe)).toMatchObject({ value: 'EU/EEA citizen' })
    expect(resolveStandard(eu, samDe)).toMatchObject({ value: 'Non-EU citizen requiring sponsorship' })
    expect(resolveStandard(field({ kind: 'textarea', label: 'Please describe your right to work' }), alexDe)).toMatchObject({ value: expect.stringContaining('do not need visa sponsorship') })
    expect(resolveStandard(field({ kind: 'textarea', label: 'Please describe your right to work' }), samDe)).toMatchObject({ value: expect.stringContaining('would need visa sponsorship') })
  })
  it('leaves work-rights questions to the person when the profile does not say', () => {
    const yn = opt(['Yes', 'No'])
    const unknown = makeCtx({}, { candidate: alex({ citizenships: [], workAuth: {} }), jobCountryCode: 'DE' })
    expect(resolveStandard(field({ kind: 'radio', label: 'Will you require visa sponsorship?', options: yn }), unknown)).toMatchObject({ type: 'pending', stdKey: 'std:requires_sponsorship' })
  })
  it('never picks another country citizenship for someone with the right to work', () => {
    const list = ["I'm a UK or Irish National", 'I do not require sponsorship to work in Ireland', 'I will need visa sponsorship to start this role']
    expect(rightToWorkOption(list, alex(), 'IE')).toBe('I do not require sponsorship to work in Ireland')
  })
  it('names the home country for "in what countries do you have the right to work"', () => {
    expect(resolveStandard(field({ kind: 'text', label: 'In what countries do you have the unrestricted right to work?' }), ctx())).toMatchObject({ value: 'Portugal' })
  })
  it('answers export-control country lists by whether the home country is on them', () => {
    const yn = opt(['Yes', 'No'])
    expect(resolveStandard(field({ kind: 'combobox', label: 'Is your most recent country of citizenship one of the following countries: Cuba, Iran, North Korea (DPRK), or Syria?', options: yn }), ctx())).toMatchObject({ value: 'No' })
    expect(resolveStandard(field({ kind: 'combobox', label: 'Are you located in one of the following countries or regions: Belarus, Cuba, Iran, North Korea (DPRK), Syria, or Russia', options: yn }), ctx())).toMatchObject({ value: 'No' })
    expect(resolveStandard(field({ kind: 'combobox', label: 'Are you located in one of the following countries: Spain, Portugal, Italy?', options: yn }), ctx())).toMatchObject({ value: 'Yes' })
  })
  it('answers N/A on export-control citizenship lists without the home country', () => {
    const f = field({ kind: 'combobox', label: 'US Export Control laws 2026: In which country did you obtain citizenship, nationality, or permanent residency first?', options: opt(['N/A', 'Iran, Cuba, Syria or North Korea', 'The additional country (NOT Iran, Cuba, Syria or North Korea)']) })
    expect(resolveStandard(f, ctx())).toMatchObject({ type: 'value', value: 'N/A' })
  })
  it('picks the sponsorship entry of a work-authorisation status list', () => {
    const f = field({ kind: 'combobox', label: 'Which best describes your work authorisation status for the location of the posting?', options: opt(['Citizen', 'Permanent Resident', 'Work Permit/ Work Visa', 'Requires Sponsorship']) })
    expect(resolveStandard(f, ctx())).toMatchObject({ type: 'value', value: 'Requires Sponsorship' })
    expect(resolveStandard(field({ kind: 'select', label: 'Visa sponsorship', options: opt(['I do not require sponsorship', 'I will require visa sponsorship']) }), ctx())).toMatchObject({ value: 'I will require visa sponsorship' })
  })
  it('never picks a status that claims a visa or right the person does not have', () => {
    const octopus = ["I'm a UK or Irish National", 'I have indefinite leave to remain or settled status', 'I have a visa that gives me permanent right to work in the UK', 'I have a visa that gives me temporary right to work in the UK, and might need sponsorship in the future', 'I will need visa sponsorship to start this role']
    expect(sponsorshipOption(octopus)).toBe('I will need visa sponsorship to start this role')
    const pleo = ['Citizen of the country where I wish to be employed', 'Valid visa or permanent resident with permission to work with any employer where this role is listed', 'I do not currently have an unlimited right to work where this role is listed and will require sponsorship']
    expect(sponsorshipOption(pleo)).toBe('I do not currently have an unlimited right to work where this role is listed and will require sponsorship')
    expect(sponsorshipOption(['Yes, I am a citizen', 'No sponsorship needed'])).toBeUndefined()
    const f = field({ kind: 'radio', label: "Could you please tell us what's your current right to work status?", options: opt(octopus) })
    expect(resolveStandard(f, ctx())).toMatchObject({ value: 'I will need visa sponsorship to start this role' })
  })
  it('gives the saved GPA when a form asks, and waits for the person when none is saved', () => {
    const graded = ctx({ bank: { rows: [], std: (k) => ({ ...STD, gpa: '17/20' })[k.replace(/^std:/, '')] ?? null, lookup: () => null } })
    expect(resolveStandard(field({ kind: 'text', label: 'GPA', required: false }), graded)).toMatchObject({ value: '17/20' })
    expect(resolveStandard(field({ kind: 'text', label: 'Cumulative grade point average', required: true }), graded)).toMatchObject({ value: '17/20' })
    expect(resolveStandard(field({ kind: 'text', label: 'GPA', required: true }), ctx())).toMatchObject({ type: 'pending', stdKey: 'std:gpa' })
    expect(resolveStandard(field({ kind: 'text', label: 'GPA', required: false }), ctx())).toMatchObject({ type: 'skip' })
  })
  it('answers veteran questions from the saved answer, else declines', () => {
    const f = field({ kind: 'select', label: 'Veteran status', options: opt(['I am a protected veteran', 'I am not a protected veteran', 'I decline to self-identify']) })
    expect(resolveStandard(f, ctx())).toMatchObject({ value: 'I am not a protected veteran' })
    expect(resolveStandard(f, makeCtx({}))).toMatchObject({ value: 'I decline to self-identify' })
    expect(resolveStandard(f, makeCtx({ veteran: 'Yes' }))).toMatchObject({ value: 'I am a protected veteran' })
  })
  it('answers gender and pronouns from the profile, even when "prefer not to say" is offered', () => {
    const c = makeCtx({ gender: '' }, { candidate: alex() })
    expect(resolveStandard(field({ kind: 'radio', label: 'What gender do you identify as?', options: opt(['Woman', 'Man', 'Non-binary', "I'd prefer not to say"]) }), c)).toMatchObject({ value: 'Non-binary' })
    expect(resolveStandard(field({ kind: 'radio', label: 'What are your pronouns?', options: opt(['He/Him', 'She/Her', 'They/Them', 'Prefer not to say']) }), c)).toMatchObject({ value: 'They/Them' })
    const female = makeCtx({ gender: 'Female', pronouns: 'She/her' })
    expect(resolveStandard(field({ kind: 'radio', label: 'What gender do you identify as?', options: opt(['Woman', 'Man', 'Non-binary', "I'd prefer not to say"]) }), female)).toMatchObject({ value: 'Woman' })
    expect(resolveStandard(field({ kind: 'select', label: 'Please indicate your gender', options: opt(['Male', 'Female', 'Prefer not to say']) }), female)).toMatchObject({ value: 'Female' })
    // Nothing saved: prefer not to say.
    expect(resolveStandard(field({ kind: 'select', label: 'Please indicate your gender', options: opt(['Male', 'Female', 'Prefer not to say']) }), makeCtx({}))).toMatchObject({ value: 'Prefer not to say' })
    // A different question: not answered with the gender.
    expect(resolveStandard(field({ kind: 'radio', label: 'Does your gender identity match your sex as registered at birth?', options: opt(['Yes', 'No', 'Prefer not to say']) }), female)).toMatchObject({ value: 'Prefer not to say' })
  })
  it('confirms a privacy notice dropdown ("I\'ve read it") instead of reading it as a notice period', () => {
    const f = field({ kind: 'combobox', label: '🔐 Keeping your data safe is really important to us. Please take a look at our Candidate Data Privacy Notice (linked below) and confirm that you have.', options: [{ label: "I've read it 👍", key: 'r' }] })
    expect(resolveStandard(f, ctx())).toMatchObject({ type: 'value', value: "I've read it 👍" })
  })
  it('leaves emailed-code boxes to the Gmail code reader and reads "Browse on your Device" as the CV upload', () => {
    const code = field({ kind: 'text', label: "A verification code was sent to alex.rivera@example.com. To submit your application, enter the 8-character code to confirm you're a human." })
    expect(resolveStandard(code, ctx())).toMatchObject({ type: 'skip' })
    expect(resolveStandard(field({ kind: 'text', label: 'Security code' }), ctx())).toMatchObject({ type: 'skip' })
    expect(resolveStandard(field({ kind: 'file', label: 'Browse on your Device', required: true }), { ...ctx(), resumePath: '/cv.pdf' })).toMatchObject({ type: 'file', source: 'resume' })
  })
  it('fills a required "Address Line 2" with the area (else the city) and skips an optional one', () => {
    expect(resolveStandard(field({ kind: 'text', label: 'Address Line 2', required: true }), ctx())).toMatchObject({ type: 'value', value: 'Lisbon' })
    const area = makeCtx({ ...STD, address_line1: 'Rua Exemplo 12, Alfama' })
    expect(resolveStandard(field({ kind: 'text', label: 'Address Line 2', required: true }), area)).toMatchObject({ type: 'value', value: 'Alfama' })
    expect(resolveStandard(field({ kind: 'text', label: 'Address Line 2', required: false }), ctx())).toMatchObject({ type: 'skip' })
  })
  it('reads "Currently based" as the location and "Home Address Country" as the country', () => {
    expect(resolveStandard(field({ kind: 'combobox', label: 'Currently based:', asyncOptions: true }), ctx())).toMatchObject({ value: 'Lisbon', within: 'Portugal' })
    expect(resolveStandard(field({ kind: 'text', label: 'Home Address Country' }), ctx())).toMatchObject({ value: 'Portugal' })
  })
  it('falls back to the region of the home country in fixed region lists', () => {
    const c = makeCtx({ ...STD }, { candidate: alex() })
    expect(resolveStandard(field({ kind: 'combobox', label: 'Location', options: opt(['North America', 'EMEA', 'APAC']) }), c)).toMatchObject({ value: 'EMEA' })
    const s = makeCtx({ city: 'Lagos', country: 'Nigeria' }, { candidate: sam() })
    expect(resolveStandard(field({ kind: 'combobox', label: 'Location', asyncOptions: true }), s)).toMatchObject({ value: 'Lagos', fallbacks: expect.arrayContaining(['Nigeria', 'Africa']) })
  })
  it('answers "which location are you applying for" with the job office, not the home city', () => {
    const label = 'Which location are you applying for? This should be the location you will be based in if you join Pleo'
    const job = { jobLocation: 'London', jobCountry: 'United Kingdom' }
    expect(resolveStandard(field({ kind: 'combobox', label, asyncOptions: true }), ctx(job))).toMatchObject({ value: 'London' })
    expect(resolveStandard(field({ kind: 'select', label, options: opt(['Copenhagen', 'Lisbon', 'London, UK', 'Madrid']) }), ctx(job))).toMatchObject({ value: 'London, UK' })
    expect(resolveStandard(field({ kind: 'combobox', label: 'Where are you currently located?', asyncOptions: true }), ctx(job))).toMatchObject({ value: 'Lisbon' })
  })
  it('answers office questions truthfully from the remote preference', () => {
    const f = field({ kind: 'radio', label: 'Are you willing to work from the office three days a week?', options: opt(['Yes', 'No']) })
    expect(resolveStandard(f, makeCtx({}, { candidate: alex() }))).toMatchObject({ value: 'Yes' })
    expect(resolveStandard(f, makeCtx({}, { candidate: sam() }))).toMatchObject({ value: 'No' })
    expect(resolveStandard(f, makeCtx({}))).toMatchObject({ type: 'pending' })
  })
  it('takes the links in turn, LinkedIn first', () => {
    const c = makeCtx({}, { candidate: alex() })
    expect(resolveStandard(field({ label: 'Link 1' }), c)).toMatchObject({ value: 'https://www.linkedin.com/in/alex-rivera-example' })
    expect(resolveStandard(field({ label: 'Link 2' }), c)).toMatchObject({ value: 'https://alexrivera.example.com' })
    expect(resolveStandard(field({ label: 'Link 3' }), c)).toMatchObject({ value: 'https://github.com/alex-rivera-example' })
  })
})

describe('salary period and text date boxes', () => {
  const STD: Record<string, string> = { salary_number: '55000', salary_expectation: 'EUR 55,000 per year, open to discuss', earliest_start: '2 months after the offer', requires_sponsorship: 'Yes' }
  const ctx = (over: Partial<StandardContext> = {}) => makeCtx(STD, over)
  const field = (over: Partial<ScannedField>): ScannedField => ({ key: 'k', kind: 'text', label: '', name: '', id: '', placeholder: '', required: true, value: '', options: [], accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: '', ...over })

  it('answers a visa follow-up box labelled only "Additional details" with the work authorisation', () => {
    const hint = 'Please provide brief, high-level information only (for example: Graduate visa valid until 2027)'
    expect(resolveStandard(field({ kind: 'textarea', label: 'Additional details', hint }), ctx())).toMatchObject({ stdKey: 'std:work_authorization' })
    expect(resolveStandard(field({ kind: 'textarea', label: 'Additional details', hint: 'Anything else we should know?' }), ctx())).toBeNull()
  })

  it('reads "the rights to work" like "the right to work"', () => {
    expect(resolveStandard(field({ kind: 'radio', label: 'Do you have the rights to work in Germany?', options: [{ label: 'Yes' }, { label: 'No' }] as never }), ctx())).toMatchObject({ value: 'No' })
  })

  it('answers "Country/Region Code:" with the phone dial code', () => {
    const mine: Record<string, string> = { phone: '+351912345678', country: 'Portugal' }
    const bank = { rows: [], std: (k: string) => mine[k.replace(/^std:/, '')] ?? null, lookup: () => null }
    expect(resolveStandard(field({ label: 'Country/Region Code:' }), ctx({ bank }))).toMatchObject({ value: '+351' })
    expect(resolveStandard(field({ kind: 'select', label: 'Country/Region Code:', options: [{ label: 'Poland (+48)' }, { label: 'Portugal (+351)' }] as never }), ctx({ bank }))).toMatchObject({ value: 'Portugal (+351)' })
  })

  it('confirms the information is accurate when asked Yes/No', () => {
    const label = 'Please confirm that all information provided is accurate and up to date before submitting your application.'
    expect(resolveStandard(field({ kind: 'radio', label, options: [{ label: 'Yes' }, { label: 'No' }] as never }), ctx())).toMatchObject({ value: 'Yes' })
  })

  it('answers yes/no citizenship questions from the citizenship', () => {
    const yn = [{ label: 'Yes' }, { label: 'No' }] as never
    const a = makeCtx({}, { candidate: alex() })
    const s = makeCtx({}, { candidate: sam() })
    expect(resolveStandard(field({ kind: 'radio', label: 'Do you have an EU citizenship?', options: yn }), a)).toMatchObject({ value: 'Yes' })
    expect(resolveStandard(field({ kind: 'radio', label: 'Are you a Portuguese citizen?', options: yn }), a)).toMatchObject({ value: 'Yes' })
    expect(resolveStandard(field({ kind: 'radio', label: 'Are you a UK citizen or passport holder?', options: yn }), a)).toMatchObject({ value: 'No' })
    expect(resolveStandard(field({ kind: 'radio', label: 'Do you have an EU citizenship?', options: yn }), s)).toMatchObject({ value: 'No' })
    expect(resolveStandard(field({ kind: 'radio', label: 'Are you a Nigerian citizen?', options: yn }), s)).toMatchObject({ value: 'Yes' })
  })

  it('dates a start-date box in the format its label or error asks for, and ticks foreign "I agree" boxes', () => {
    const start = earliestStartDate({ earliestStart: STD.earliest_start, noticePeriod: null }, { needsVisa: true })!
    const [y, m, d] = start.split('-')
    expect(resolveStandard(field({ label: 'Earliest starting date (YYYY-MM-DD)' }), ctx())).toMatchObject({ value: start })
    expect(resolveStandard(field({ label: 'Earliest starting date (YYYY-MM-DD)', error: 'Please enter the date in the format DD.MM.YYYY.' }), ctx())).toMatchObject({ value: `${d}.${m}.${y}` })
    expect(resolveStandard(field({ label: 'Available from' }), ctx())).toMatchObject({ value: start })
    expect(resolveStandard(field({ kind: 'checkbox', label: 'Concordo com a termos e condições & política de privacidade' }), ctx())).toMatchObject({ checked: true })
  })

  it('leaves a date box to the person when no start or notice is saved', () => {
    expect(resolveStandard(field({ kind: 'date', label: 'Earliest start date' }), makeCtx({}))).toMatchObject({ type: 'pending', stdKey: 'std:earliest_start' })
  })

  it('leaves referral boxes empty instead of putting the person own name there', () => {
    expect(resolveStandard(field({ label: 'Recommendation by (last name, first name)', required: false }), ctx())).toMatchObject({ type: 'skip' })
    expect(resolveStandard(field({ label: 'Referred by', required: true }), ctx())).toMatchObject({ value: 'Not applicable' })
  })

  it('dates a signature line today, in the format the field hints at', () => {
    const day = new Date(2026, 9, 6)
    expect(signatureDate(field({ label: 'Date' }), day)).toBe('06/10/2026')
    expect(signatureDate(field({ label: 'Date', hint: 'MM/DD/YYYY' }), day)).toBe('10/06/2026')
    expect(signatureDate(field({ kind: 'date', label: 'Date' }), day)).toBe('2026-10-06')
    expect(resolveStandard(field({ label: 'Date' }), ctx())).toMatchObject({ source: 'rule' })
  })

  it('asks a daily rate when the question is daily', () => {
    expect(resolveStandard(field({ label: 'What are your daily salary expectations in EUR?' }), ctx({ salaryAsk: { amount: 52000, currency: 'EUR' } }))).toMatchObject({ value: 'EUR 240 per day, open to discuss' })
  })

  it('asks a monthly figure when the question is monthly', () => {
    expect(resolveStandard(field({ kind: 'number', label: 'Expected gross monthly salary' }), ctx({ salaryAsk: { amount: 52000, currency: 'EUR' } }))).toMatchObject({ value: '4300' })
    expect(resolveStandard(field({ kind: 'number', label: 'Expected gross monthly salary' }), ctx())).toMatchObject({ value: '4600' })
    expect(resolveStandard(field({ label: 'What are your salary expectations? (monthly- euros)' }), ctx({ salaryAsk: { amount: 52000, currency: 'EUR' } }))).toMatchObject({ value: 'EUR 4,300 per month (gross), open to discuss' })
    expect(resolveStandard(field({ kind: 'number', label: 'Expected yearly salary' }), ctx({ salaryAsk: { amount: 52000, currency: 'EUR' } }))).toMatchObject({ value: '52000' })
    // A 20-character box: the short form.
    expect(resolveStandard(field({ label: 'What is your salary expectation?', maxLength: 20 }), ctx({ salaryAsk: { amount: 55000, currency: 'EUR' } }))).toMatchObject({ value: 'EUR 55,000' })
  })
  it('puts a real date into a date-picker text box', () => {
    const v = resolveStandard(field({ label: 'What is your earliest starting date', placeholder: 'Pick date...' }), ctx()) as { value: string }
    expect(v.value).toMatch(/^\d{4}-\d{2}-01$/)
    expect(dateInFormat('2027-02-01', 'DD/MM/YYYY')).toBe('01/02/2027')
    expect(dateInFormat('2027-02-01', 'mm.dd.yyyy')).toBe('02.01.2027')
    expect(resolveStandard(field({ label: 'Earliest possible start date' }), ctx())).toMatchObject({ value: '2 months after the offer' })
  })
})

describe('diversity answers on a SmartRecruiters form', () => {
  const STD: Record<string, string> = { gender: 'Female', sexual_orientation: 'Bisexual', caring_responsibilities: 'None', disability: 'No', ethnicity: 'Prefer not to say', religion: 'Catholic', requires_sponsorship: 'Yes', country: 'Portugal' }
  const ctx = () => makeCtx(STD)
  const box = (label: string, options: string[] = []): ScannedField => ({ key: 'k', kind: 'combobox', label, name: '', id: '', placeholder: '', required: true, value: '', options: options.map((o) => ({ value: o, label: o })), accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: '' })

  it('never matches Male to Female or No to Non-binary', () => {
    expect(matchOption('Male', ['Female', 'Man'])).not.toBe('Female')
    expect(matchOption('Male', ['Female'])).toBeNull()
    expect(matchOption('No', ['Man', 'Woman', 'Non-binary'])).toBeNull()
  })
  it('answers diversity questions with the saved answers', () => {
    expect(resolveStandard(box('Please select your Gender Identity', ['Man', 'Woman', 'Non-binary', 'Prefer not to say']), ctx())).toMatchObject({ value: 'Woman' })
    expect(resolveStandard(box('What is your sexual orientation?', ['Bisexual', 'Gay', 'Straight', 'Prefer not to say']), ctx())).toMatchObject({ value: 'Bisexual' })
    expect(resolveStandard(box('What are your caring responsibilities?', ['Primary carer of a child', 'None', 'Prefer not to say']), ctx())).toMatchObject({ value: 'None' })
    expect(resolveStandard(box('Do you identify as having a disability, long-term health condition, or are you neurodivergent?', ['Yes', 'No', 'Prefer not to say']), ctx())).toMatchObject({ value: 'No' })
    expect(resolveStandard(box('What is your ethnic background?', ['Irish', 'Asian or Asian Irish', 'Prefer not to say']), ctx())).toMatchObject({ value: 'Prefer not to say' })
    expect(resolveStandard(box('Please indicate the religious community to which you belong', ['Catholic community', 'Protestant community', 'No religion']), ctx())).toMatchObject({ value: 'Catholic community' })
  })
  it('finds the same answer in another wording of the list', () => {
    const straight = makeCtx({ sexual_orientation: 'Straight' })
    expect(resolveStandard(box('What is your sexual orientation?', ['Gay or lesbian', 'Hetero / straight', 'Bisexual', 'Prefer not to say']), straight)).toMatchObject({ value: 'Hetero / straight' })
  })
  it('types the answer with alternatives when the list loads only while typing', () => {
    expect(resolveStandard(box('Please select your Gender Identity'), ctx())).toMatchObject({ value: 'Female', fallbacks: ['Woman', 'Cisgender woman', 'Cis woman'] })
  })
  it('asks the person for the current salary instead of guessing', () => {
    expect(resolveStandard({ ...box('What is your current base salary?'), kind: 'number' }, ctx())).toMatchObject({ type: 'pending', stdKey: 'std:current_salary' })
  })
})

describe('German work and declaration questions', () => {
  const ctx = () => makeCtx({ requires_sponsorship: 'Yes', country: 'Nigeria' })
  const f = (label: string, kind: ScannedField['kind'], options: string[] = []): ScannedField => ({ key: 'k', kind, label, name: '', id: '', placeholder: '', required: true, value: '', options: options.map((o) => ({ value: o, label: o })), accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: '' })

  it('says Nein to "legally allowed to work" in German for someone who needs sponsorship, Ja for an EU citizen', () => {
    const q = f('Bist Du, in dem Land indem Du dich bewirbst, rechtlich zur Arbeit berechtigt?', 'radio', ['Ja', 'Nein'])
    expect(resolveStandard(q, ctx())).toMatchObject({ value: 'Nein' })
    expect(resolveStandard(q, makeCtx({}, { candidate: alex(), jobCountryCode: 'DE' }))).toMatchObject({ value: 'Ja' })
  })
  it('ticks a German declaration that is true', () => {
    expect(resolveStandard(f('Ich erkläre hiermit, dass ich volljährig bin und die Angaben zu meiner Person wahrheitsgemäß sind', 'checkbox'), ctx())).toMatchObject({ checked: true })
  })
})

describe('Recruitee phone box with the dial code inside', () => {
  const STD: Record<string, string> = { phone: '+351 912345678', phone_country: 'Portugal', country: 'Portugal' }
  const ctx = (over: Partial<StandardContext> = {}) => makeCtx(STD, over)
  const tel: ScannedField = { key: 't', kind: 'tel', label: 'Phone number', name: '', id: '', placeholder: '', required: true, value: '+32', options: [], accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: '' }
  const picker: ScannedField = { ...tel, key: 'p', kind: 'listbox', label: 'Select country calling code: Belgium', value: 'Belgium' }

  it('types the full international number', () => {
    expect(resolveStandard(tel, ctx({ phoneHasCountryPicker: true, phoneTypesDialCode: true }))).toMatchObject({ value: '+351 912345678' })
  })
  it('sets a picker left on another country to the home country (Recruitee 422 at DPG Media)', () => {
    expect(resolveStandard(picker, ctx({ phoneHasCountryPicker: true, phoneTypesDialCode: true }))).toMatchObject({ type: 'value', value: 'Portugal' })
    const withOptions = { ...picker, options: ['Belgium (+32)', 'Portugal (+351)', 'Netherlands (+31)'].map((label) => ({ label })) }
    expect(resolveStandard(withOptions, ctx({ phoneHasCountryPicker: true, phoneTypesDialCode: true }))).toMatchObject({ type: 'value', value: 'Portugal (+351)' })
  })
  it('leaves a picker that already shows the home country', () => {
    expect(resolveStandard({ ...picker, label: 'Select country calling code: Portugal', value: 'Portugal' }, ctx({ phoneHasCountryPicker: true, phoneTypesDialCode: true }))).toMatchObject({ type: 'skip' })
  })
})

describe('yesNo in other languages', () => {
  it('matches accented and local Yes/No labels', () => {
    expect(yesNo(['Sí', 'No'], true)).toBe('Sí')
    expect(yesNo(['Sim', 'Não'], false)).toBe('Não')
    expect(yesNo(['Ja', 'Nej'], false)).toBe('Nej')
    expect(yesNo(['Yes', 'No'], true)).toBe('Yes')
    expect(yesNo(['Nordics only', 'Other'], false)).toBe(null)
  })
})

describe('currently based in a city', () => {
  const ctx = () => makeCtx({ city: 'Lisbon', country: 'Portugal' })
  const field = (label: string): ScannedField => ({ key: 'k', kind: 'radio', label, name: '', id: '', placeholder: '', required: true, value: '', options: [{ label: 'Yes', key: 'y' }, { label: 'No', key: 'n' }], accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: '' })
  it('answers No for another city and Yes for the home city (Innovecs)', () => {
    expect(resolveStandard(field('Are you currently based in Prague or nearby?'), ctx())).toMatchObject({ value: 'No' })
    expect(resolveStandard(field('Are you currently based in Lisbon?'), ctx())).toMatchObject({ value: 'Yes' })
  })
})

describe('"state" the verb is no region (Kpler)', () => {
  const ctx = () => makeCtx({ region: 'Lisbon District', city: 'Lisbon', country: 'Portugal', salary_number: '55000', salary_expectation: 'EUR 55,000 per year, open to discuss' })
  const text = (label: string): ScannedField => ({ key: 'k', kind: 'text', label, name: '', id: '', placeholder: '', required: true, value: '', options: [], accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: '' })
  it('never answers a salary question with the region', () => {
    const r = resolveStandard(text('Your basic annual gross salary expectation (Please state currency)'), ctx())
    expect(r && 'value' in r ? r.value : null).not.toBe('Lisbon District')
  })
  it('still answers a real region box', () => {
    expect(resolveStandard(text('State / Province'), ctx())).toMatchObject({ value: 'Lisbon District' })
  })
})

describe('a diversity section (Energy Aspects)', () => {
  const STD: Record<string, string> = { gender: 'Female', ethnicity: 'White', sexual_orientation: 'Gay', religion: 'No religion', marital_status: 'Single', disability: 'No', pronouns: 'She/her/hers', date_of_birth: '1990-03-15' }
  const ctx = makeCtx(STD)
  const sel = (label: string, options: string[]): ScannedField => ({ key: label, kind: 'select', label, name: '', id: '', placeholder: '', required: false, value: '', options: options.map((o) => ({ label: o })), accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: 'Diversity and Inclusion', hint: '' })
  it('answers every question from the saved answers', () => {
    const born = new Date('1990-03-15')
    const now = new Date()
    const age = now.getFullYear() - 1990 - (now < new Date(now.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0)
    expect(resolveStandard(sel('Gender Identity', ['Male', 'Female', 'Non-binary', 'Prefer not to say']), ctx)).toMatchObject({ value: 'Female' })
    expect(resolveStandard(sel('Ethnicity', ['White', 'Black', 'Asian', 'Mixed', 'Prefer not to say']), ctx)).toMatchObject({ value: 'White' })
    expect(resolveStandard(sel('Ethnicity', ['White - other', 'Black or Black British', 'Prefer not to say']), ctx)).toMatchObject({ value: 'White - other' })
    expect(resolveStandard(sel('Sexual Orientation', ['Straight', 'Gay', 'Bisexual', 'Prefer not to say']), ctx)).toMatchObject({ value: 'Gay' })
    expect(resolveStandard(sel('Religion', ['Christian', 'Jewish', 'Hindu', 'No religion']), ctx)).toMatchObject({ value: 'No religion' })
    expect(resolveStandard(sel('Marital Status', ['Single', 'Married', 'Divorced', 'Prefer not to say']), ctx)).toMatchObject({ value: 'Single' })
    expect(resolveStandard(sel('Age Bracket', ['18-24', '25-34', '35-44', '45-54', 'Prefer not to say']), ctx)).toMatchObject({ value: ageBracketWords(age, ['18-24', '25-34', '35-44', '45-54'])[0] })
    expect(resolveStandard(sel('Disability', ['Yes', 'No', 'Prefer not to say']), ctx)).toMatchObject({ value: 'No' })
    expect(resolveStandard(sel('Preferred Pronouns', ['She/Her/Hers', 'He/Him/His', 'They/Them', 'Prefer not to say']), ctx)).toMatchObject({ value: 'She/Her/Hers' })
  })
  it('finds the age band in any wording', () => {
    expect(ageBracketWords(32, ['Under 25', '25 to 34', '35 to 44'])).toEqual(['25 to 34'])
    expect(ageBracketWords(32, ['18-29', '30-39', '40+'])).toEqual(['30-39'])
    expect(ageBracketWords(46, ['18-29', '30-39', '40+'])).toEqual(['40+'])
    expect(ageBracketWords(32, [])[0]).toBe('25-34')
  })
})

describe('former employee of this company', () => {
  const ctx = makeCtx({}, { candidate: alex() })
  const sel = (label: string, options: string[]): ScannedField => ({ key: label, kind: 'select', label, name: '', id: '', placeholder: '', required: true, value: '', options: options.map((o) => ({ label: o })), accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: '' })
  it('answers No for any other company, in any wording', () => {
    expect(resolveStandard(sel('Please select if you were a previous Unity employee.', ['Yes', 'No']), ctx)).toMatchObject({ value: 'No' })
    expect(resolveStandard(sel('Have you previously been employed by Elekta?', ['Yes, I have previously been employed by Elekta.', 'No, I have NOT been previously employed by Elekta.']), ctx)).toMatchObject({ value: 'No, I have NOT been previously employed by Elekta.' })
    expect(resolveStandard(sel('Are you a former employee of GE HealthCare?', ['Yes', 'No']), ctx)).toMatchObject({ value: 'No' })
  })
  it('answers Yes for one of the person own employers, from the profile', () => {
    expect(resolveStandard(sel('Have you previously been employed by Northwind Labs?', ['Yes', 'No']), ctx)).toMatchObject({ value: 'Yes' })
    expect(resolveStandard(sel('Are you a former employee of Contoso Digital Ltd?', ['Yes', 'No']), ctx)).toMatchObject({ value: 'Yes' })
    expect(resolveStandard(sel('Have you previously been employed by Northwind Labs?', ['Yes', 'No']), makeCtx({}, { candidate: sam() }))).toMatchObject({ value: 'No' })
  })
})

describe('Greenhouse education, employer and languages (OKX)', () => {
  const STD: Record<string, string> = { school: 'University of Lisbon', graduation_year: '2018', current_company: 'Northwind Labs', earliest_start: '2 months after the offer' }
  const ctx = makeCtx(STD)
  const field = (label: string, kind: ScannedField['kind'], options: string[] = [], required = false): ScannedField => ({ key: label, kind, label, name: '', id: '', placeholder: '', required, value: '', options: options.map((o) => ({ label: o })), accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: '' })
  it('fills education years from the degree, never the job start date', () => {
    expect(resolveStandard(field('End date year', 'text'), ctx)).toMatchObject({ value: '2018' })
    expect(resolveStandard(field('Start date year', 'text'), ctx)).toMatchObject({ type: 'skip' })
    expect(resolveStandard(field('Start date year', 'text', [], true), ctx)).toMatchObject({ value: '2014' })
    // A bachelor in a Bologna country usually takes three years.
    expect(resolveStandard(field('Start date year', 'text', [], true), makeCtx(STD, { candidate: alex() }))).toMatchObject({ value: '2015' })
  })
  it('types the school into a school search box, with a shorter part of its name and Other as fallbacks', () => {
    expect(resolveStandard(field('School', 'combobox', ['Aalborg University', 'Others']), ctx)).toMatchObject({ value: 'University of Lisbon', fallbacks: ['Lisbon', 'Other'] })
  })
  it('names the current employer and ticks the person languages', () => {
    expect(resolveStandard(field('Where are you currently employed or where were you last employed?', 'text'), ctx)).toMatchObject({ value: 'Northwind Labs' })
    const withAlex = makeCtx(STD, { candidate: alex() })
    expect(resolveStandard(field('What language(s) are you fluent in?', 'checkboxes', ['English', 'Mandarin Chinese', 'Portuguese', 'Hindi']), withAlex)).toMatchObject({ type: 'choices', choices: ['English', 'Portuguese'] })
  })
  it('gives each language its own level, as the nearest option', () => {
    const withAlex = makeCtx(STD, { candidate: alex() })
    expect(resolveStandard(field('English level', 'select', ['Beginner', 'Intermediate', 'Fluent', 'Native']), withAlex)).toMatchObject({ value: 'Fluent' })
    expect(resolveStandard(field('Portuguese proficiency', 'select', ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']), withAlex)).toMatchObject({ value: 'C2' })
    expect(resolveStandard(field('English proficiency level', 'text'), withAlex)).toMatchObject({ value: 'Fluent (C1)' })
    // A language the person did not list is left to the other rules.
    expect(resolveStandard(field('German level', 'select', ['Beginner', 'Fluent']), withAlex)).toBeNull()
  })
})
