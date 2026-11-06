import { describe, expect, it } from 'vitest'
import { ALREADY_APPLIED_RE, EMAIL_VERIFY_URL_RE, KNOCKOUT_RE } from './knockout'

describe('knockout and already-applied text', () => {
  it('reads the requirement gate in several languages', () => {
    for (const t of ['You have to meet these requirements to be able to apply', 'Tienes que cumplir estos requisitos para poder postularte', 'Sie müssen diese Voraussetzungen erfüllen', 'Vous devez remplir ces conditions']) {
      expect(KNOCKOUT_RE.test(t), t).toBe(true)
    }
    expect(KNOCKOUT_RE.test('Please make sure you meet the deadline')).toBe(false)
  })
  it('reads "already applied" answers', () => {
    expect(ALREADY_APPLIED_RE.test('{"error":"You have already applied to this position."}')).toBe(true)
    expect(ALREADY_APPLIED_RE.test('Your application has already been submitted')).toBe(true)
    expect(ALREADY_APPLIED_RE.test('Apply for this position')).toBe(false)
  })
  it('treats an email-verification page as unfinished (Teamtailor)', () => {
    expect(EMAIL_VERIFY_URL_RE.test('https://x.teamtailor.com/jobs/1-dev/applications/email_verification_needed')).toBe(true)
    expect(EMAIL_VERIFY_URL_RE.test('https://x.teamtailor.com/jobs/1-dev/applications/thank_you')).toBe(false)
  })
})
