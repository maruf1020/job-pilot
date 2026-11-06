import { describe, expect, it } from 'vitest'
import { buildCandidateContext } from '@/lib/candidate/context'
import { alex, sam } from './__fixtures__/personas'
import { claimsFalseRight, truthfulWorkAnswer, worthASecondLook } from './fixer'

describe('second look', () => {
  it('helps with forms that are stuck on the form itself', () => {
    for (const r of [
      'Could not find a Next or Submit button on this page',
      '"Next" does not move past this page. Everything else is filled; please finish it in the tab.',
      'Pressed Submit; the page says: A required field is empty, blocking the submission.',
      'Could not fill: "Link 2" (invalid)',
      '"Submit" stays disabled although every required field looks filled; please check the tab and submit.',
    ]) {
      expect(worthASecondLook(r), r).toBe(true)
    }
  })

  it('stays out of what needs you, and of anything that may already be sent', () => {
    for (const r of [
      'A CAPTCHA needs a person. Solve it in the apply browser and finish there, or press Retry after solving it.',
      'jobindex.dk asks you to sign in. Log in once in the apply browser (the login is saved), then press Retry.',
      'career5.successfactors.eu creates an account as part of applying (it asks you to choose a password).',
      'Pressed submit but saw no confirmation; check the tab before trying again',
      'The site asks for the code it emailed you. Enter it in the apply browser.',
      'Access is temporarily restricted due to bot detection on the page.',
    ]) {
      expect(worthASecondLook(r), r).toBe(false)
    }
  })
})

describe('second look on visa questions', () => {
  const SPONSOR = 'Will you now or in the future require visa sponsorship?'
  const AUTH = 'Are you legally authorized to work in Germany?'
  it('someone who needs sponsorship (Sam, NG) answers sponsorship Yes, authorised No', () => {
    const s = sam()
    expect(truthfulWorkAnswer(SPONSOR, 'Yes', s, 'DE')).toBe(true)
    expect(truthfulWorkAnswer(SPONSOR, 'No', s, 'DE')).toBe(false)
    expect(truthfulWorkAnswer(AUTH, 'No', s, 'DE')).toBe(true)
    expect(truthfulWorkAnswer(AUTH, 'Yes', s, 'DE')).toBe(false)
    expect(truthfulWorkAnswer('Are you authorized to work in Germany without requiring sponsorship?', 'No', s, 'DE')).toBe(true)
    expect(truthfulWorkAnswer('Eligibility to work in the Republic of Ireland', 'I am an Irish Citizen', s, 'IE')).toBe(false)
    expect(truthfulWorkAnswer('Eligibility to work in the Republic of Ireland', 'I require a work permit', s, 'IE')).toBe(true)
    expect(truthfulWorkAnswer('Have you built a matching system?', 'Yes', s, 'DE')).toBe(true)
  })
  it('an EU citizen (Alex, PT) applying in DE flips both answers', () => {
    const a = alex()
    expect(truthfulWorkAnswer(SPONSOR, 'No', a, 'DE')).toBe(true)
    expect(truthfulWorkAnswer(SPONSOR, 'Yes', a, 'DE')).toBe(false)
    expect(truthfulWorkAnswer(AUTH, 'Yes', a, 'DE')).toBe(true)
    expect(truthfulWorkAnswer(AUTH, 'No', a, 'DE')).toBe(false)
    expect(truthfulWorkAnswer('Eligibility to work in the Republic of Ireland', 'I am an EU citizen', a, 'IE')).toBe(true)
    // The right to work, but not another country's citizenship.
    expect(truthfulWorkAnswer('Eligibility to work in the Republic of Ireland', 'I am an Irish Citizen', a, 'IE')).toBe(false)
    expect(truthfulWorkAnswer('Eligibility to work in the Republic of Ireland', 'I require a work permit', a, 'IE')).toBe(false)
  })
  it('leaves the answer to the person when the profile does not say', () => {
    const unknown = buildCandidateContext({ fullName: 'Alex Rivera', country: 'PT' })
    expect(truthfulWorkAnswer(SPONSOR, 'Yes', unknown, 'DE')).toBe(false)
    expect(truthfulWorkAnswer(SPONSOR, 'No', unknown, 'DE')).toBe(false)
    expect(truthfulWorkAnswer('What is your favourite colour?', 'Blue', unknown, 'DE')).toBe(true)
  })
  it('refuses option claims that are not the person own', () => {
    expect(claimsFalseRight('I am a permanent resident', sam(), 'GB')).toBe(true)
    expect(claimsFalseRight('Portuguese citizen', alex(), 'DE')).toBe(false)
    expect(claimsFalseRight('British citizen', alex(), 'DE')).toBe(true)
    expect(claimsFalseRight('I am a British citizen', alex(), 'GB')).toBe(true)
  })
})

import { toneDown } from './driver'
describe('toneDown', () => {
  it('removes eager-applicant words', () => {
    expect(toneDown('I am very excited to apply for this role.')).toBe('I would like to apply for this role.')
    expect(toneDown("I'm passionate about clean code")).toBe('I care about clean code')
    expect(toneDown('I am excited by your product')).toBe('I care about your product')
    expect(toneDown('A thrilled team player')).toBe('A keen team player')
    expect(toneDown('Plain answer')).toBe('Plain answer')
  })
})
