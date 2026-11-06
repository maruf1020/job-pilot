import { describe, expect, it } from 'vitest'
import { checkFreeText } from '@/lib/pipeline/humanize/free-text'
import { computeRuleScore, offStackTitle } from '@/lib/ranking/rules'
import { DEFAULT_RANKING, DEFAULT_SEARCH } from '@/lib/settings/schema'
import { cleanOptions, unreadableLabel } from './answer-bank'
import { planAnswers, type PlanContext } from './plan'
import { resolveStandard, type StandardContext } from './standard'
import type { ScannedField } from './types'

const field = (over: Partial<ScannedField>): ScannedField => ({ key: 'k', kind: 'text', label: '', name: '', id: '', placeholder: '', required: true, value: '', options: [], accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: '', ...over })
const opts = (xs: string[]) => xs.map((label) => ({ label, key: label }))
const std = (): StandardContext => ({ bank: { rows: [], std: () => null, lookup: () => null }, email: 'a@example.org', fullName: 'Alex Rivera', yearsExperience: 5, coverLetter: null, resumePath: 'cv.pdf', coverLetterPath: null, coverLetterEverywhere: false })

describe('written answers follow the email rules', () => {
  it('swaps banned words and fixes punctuation', () => {
    const r = checkFreeText("I'm eager to join — and passionate about payments!")
    expect(r.problems).toEqual([])
    expect(r.text).toBe("I'm keen to join, and keen on payments.")
    expect(checkFreeText('Excited to help. Additionally, I leveraged Node.js.').text).toBe('Glad to help. Also, I used Node.js.')
  })
  it('reports phrases a swap cannot fix', () => {
    expect(checkFreeText('A rich tapestry of products.').problems).toEqual(['tapestry'])
  })
  it('rewrites an AI answer once, and never types one that still fails', async () => {
    const f1 = field({ key: 'a', kind: 'textarea', label: 'Why do you want to work here?' })
    const f2 = field({ key: 'b', kind: 'textarea', label: 'Anything else you would like to share?' })
    const ctx: PlanContext = {
      ...std(),
      profile: {} as PlanContext['profile'],
      job: {} as PlanContext['job'],
      company: 'Acme',
      useAi: true,
      primaryOk: false,
      remember: false,
      bannedPhrases: [{ phrase: 'tapestry', severity: 'error', category: 'buzzword' }],
      aiAnswer: async () => [
        { key: 'a', value: 'Your payments platform is a rich tapestry of services I know well from my HRMS work.', choices: null, needsHuman: false, reason: null },
        { key: 'b', value: 'Another rich tapestry here, built over five years of product work.', choices: null, needsHuman: false, reason: null },
      ],
      rewriteText: async (items) => items.filter((i) => i.key === 'a').map((i) => ({ key: i.key, text: i.text.replace('a rich tapestry of', 'a mix of') })),
    }
    const plan = await planAnswers([f1, f2], ctx)
    expect(plan.answers.find((a) => a.key === 'a')?.value).toContain('a mix of')
    expect(plan.answers.find((a) => a.key === 'b')).toBeUndefined()
    expect(plan.open.map((o) => o.reason).join(' ')).toMatch(/tapestry/)
  })
})

describe('reading and data-processing declarations', () => {
  const yn = opts(['Yes', 'No'])
  it('answers Yes to having read a privacy or processing notice', () => {
    for (const label of [
      'You declare that you have read the information about the processing of your personal data',
      'I confirm that I have read and understood the Candidate Privacy Notice',
      'Do you consent to the processing of your personal data for this application?',
      'I agree to the storage of my application data for the recruitment process',
    ]) expect(resolveStandard(field({ kind: 'radio', label, options: yn }), std()), label).toMatchObject({ value: 'Yes' })
  })
  it('answers No to marketing opt-ins, even next to a privacy policy', () => {
    expect(resolveStandard(field({ kind: 'select', label: 'I agree to receive marketing emails as described in the privacy policy', options: yn }), std())).toMatchObject({ value: 'No' })
    expect(resolveStandard(field({ kind: 'radio', label: 'Subscribe to our newsletter?', options: yn }), std())).toMatchObject({ value: 'No' })
  })
  it('leaves signatures and compliance declarations alone', () => {
    const sig = resolveStandard(field({ kind: 'radio', label: 'I confirm I have read the policy and my typed name serves as my electronic signature', options: yn }), std())
    expect(sig).not.toMatchObject({ value: 'Yes' })
    const crim = resolveStandard(field({ kind: 'radio', label: 'Have you read our notice on criminal convictions and do you have any unspent convictions?', options: yn }), std())
    expect(crim).not.toMatchObject({ value: 'Yes' })
  })
})

describe('answer bank hygiene', () => {
  it('sees labels the scanner could not read', () => {
    expect(unreadableLabel('Unnamed field')).toBe(true)
    expect(unreadableLabel('radio-group-_r_46_')).toBe(true)
    expect(unreadableLabel('')).toBe(true)
    expect(unreadableLabel('Are you legally authorized to work in Poland?')).toBe(false)
    expect(unreadableLabel('LinkedIn')).toBe(false)
  })
  it('drops "on" options and the question repeated as an option', () => {
    expect(cleanOptions(['on', 'on'])).toEqual([])
    expect(cleanOptions(['Do you have experience?', 'Yes', 'No'], 'Do you have experience?')).toEqual(['Yes', 'No'])
  })
  it('does not guess a radio group labelled only by an element id', async () => {
    const ctx = { ...std(), profile: {} as PlanContext['profile'], job: {} as PlanContext['job'], company: 'Acme', useAi: false, primaryOk: false, remember: false } as PlanContext
    const plan = await planAnswers([field({ kind: 'radio', label: 'radio-group-_r_46_', options: opts(['Yes', 'No']) })], ctx)
    expect(plan.answers).toEqual([])
    expect(plan.open[0]?.reason).toMatch(/could not read/)
  })
  it('leaves a header sign-in email box alone, but still answers "have you applied before"', async () => {
    const ctx = { ...std(), profile: {} as PlanContext['profile'], job: {} as PlanContext['job'], company: 'Acme', useAi: false, primaryOk: false, remember: false } as PlanContext
    const plan = await planAnswers([field({ kind: 'email', label: 'Log in here if you previously have applied for a job with us: Email' })], ctx)
    expect(plan.answers).toEqual([])
    expect(plan.skipped).toContainEqual({ label: 'Log in here if you previously have applied for a job with us: Email', reason: 'sign-in box' })
    const q = await planAnswers([field({ kind: 'radio', label: 'Have you previously applied to Acme?', options: opts(['Yes', 'No']) })], ctx)
    expect(q.skipped.some((s) => s.reason === 'sign-in box')).toBe(false)
  })
})

describe('titles built on another stack', () => {
  it('names the other stack, not when the stack of the user is in the title', () => {
    expect(offStackTitle('Golang Backend Engineer')).toBe('golang')
    expect(offStackTitle('Senior Backend Engineer (Go)')).toBe('go')
    expect(offStackTitle('Java Developer')).toBe('java')
    expect(offStackTitle('Senior Ruby on Rails Engineer')).toBe('ruby')
    expect(offStackTitle('Full Stack Engineer (Java/React)')).toBeNull()
    expect(offStackTitle('Senior JavaScript Engineer')).toBeNull()
    expect(offStackTitle('Go-to-Market Engineer')).toBeNull()
    expect(offStackTitle('Software Engineer, Trust & Safety')).toBeNull()
  })
  it('keeps an off-stack title under the fit line', () => {
    const job = { title: 'Golang Backend Engineer', description: 'We offer visa sponsorship and relocation. TypeScript, React, Node.js on AWS.', countryCode: 'IE', sponsorship: 'yes', seniority: 'senior', postedAt: new Date(), knownSponsor: true }
    const r = computeRuleScore(job, { titles: ['Backend Engineer'], skills: ['TypeScript', 'React', 'Node.js'] }, DEFAULT_RANKING, { ...DEFAULT_SEARCH, profession: 'software' })
    expect(r.score).toBeLessThanOrEqual(30)
    expect(r.breakdown.map((b) => b.label).join('|')).toMatch(/another stack \(golang\)/)
  })
})
