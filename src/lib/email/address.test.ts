import { describe, expect, it } from 'vitest'
import { companyMismatchReason, isUsableContact, mailboxPurposeReason, unusableContactReason } from './address'

describe('recipient address rules', () => {
  it('rejects mailboxes that postings mention but that are not for applications', () => {
    for (const e of [
      'candidateaccommodations@toasttab.com',
      'candidate_accessibility@elastic.co',
      'accommodations@coinbase.com',
      'security-esk@contentful.com',
      'privacy@acme.ie',
      'dpo@acme.ie',
      'press@acme.ie',
      'support@acme.ie',
      'noreply@acme.ie',
      'do-not-reply@acme.ie',
      'complaints@acme.ie',
    ]) {
      expect(isUsableContact(e), e).toBe(false)
      expect(unusableContactReason(e), e).toMatch(/not a recruiting address/)
    }
  })

  it('accepts recruiting-style addresses', () => {
    for (const e of ['careers@acme.ie', 'jobs@acme.ie', 'recruiting@acme.ie', 'talent@acme.ie', 'hr@acme.ie', 'people@acme.ie', 'hello@acme.ie', 'sarah.murphy@acme.ie']) {
      expect(isUsableContact(e), e).toBe(true)
      expect(unusableContactReason(e), e).toBeNull()
    }
  })

  it('explains missing or malformed addresses', () => {
    expect(unusableContactReason(null)).toBe('no recipient address')
    expect(unusableContactReason('not-an-email')).toBe('not a valid email address')
  })

  it('rejects job-board mailboxes and opt-out addresses', () => {
    for (const e of ['careers@themuse.com', 'jobs@linkedin.com', 'support@jooble.org', 'no-reply@greenhouse.io', 'advertising-opt-out@clickhouse.com', 'optout@acme.ie']) {
      expect(isUsableContact(e), e).toBe(false)
    }
    expect(unusableContactReason('careers@themuse.com')).toMatch(/job board/)
    expect(isUsableContact('careers@clickhouse.com')).toBe(true)
    // Look-alikes of board names must not be caught.
    expect(isUsableContact('jobs@clever.io')).toBe(true)
    expect(isUsableContact('hr@motta.de')).toBe(true)
  })

  it('never lets mail go to reserved or demo domains', () => {
    for (const e of ['jobs@demo-fintech.example', 'hr@acme.invalid', 'x@company.test', 'a@example.com']) {
      expect(isUsableContact(e), e).toBe(false)
      expect(unusableContactReason(e), e).toMatch(/reserved test domain/)
    }
    expect(isUsableContact('careers@example-company.ie')).toBe(true)
  })

  it('rejects template placeholders, file names and system addresses found on websites', () => {
    for (const e of ['you@yourcompany.com', 'you@company.com', 'user@domain.com', 'sarah@email.com', 'john@mail.com', 'name@your-domain.com']) {
      expect(isUsableContact(e), e).toBe(false)
      expect(unusableContactReason(e), e).toMatch(/placeholder/)
    }
    for (const e of ['sumup_email@2x.png', 'flags@2x.webp', 'logo@3x.jpg']) {
      expect(isUsableContact(e), e).toBe(false)
      expect(unusableContactReason(e), e).toBe('not a valid email address')
    }
    for (const e of ['9554c792fe3f41df840d6ca36332a0f5@o153781.ingest.sentry.io', '7662faec01ce4f4b9f13b275a938fdfc@sentry.io', 'x@sentry-next.wixpress.com']) {
      expect(isUsableContact(e), e).toBe(false)
      expect(unusableContactReason(e), e).toMatch(/system address/)
    }
    // Real company domains that merely contain these words stay usable.
    for (const e of ['careers@mycompanyhub.io', 'jobs@domainbrokers.de', 'talent@mailchimp.com', 'jobs@sentry.io', 'cafe@acme.ie']) {
      expect(isUsableContact(e), e).toBe(true)
    }
  })

  it('rejects data-protection authorities and trademark mailboxes that postings mention', () => {
    expect(isUsableContact('info@dataprotection.ie')).toBe(false)
    expect(unusableContactReason('info@dataprotection.ie')).toMatch(/data-protection authority/)
    expect(isUsableContact('casework@ico.org.uk')).toBe(false)
    expect(isUsableContact('trademarks@clickhouse.com')).toBe(false)
    expect(isUsableContact('datenschutz@acme.de')).toBe(false)
  })
})

describe('recipient must belong to the company (automatic sends)', () => {
  const ok = (email: string, name: string, domain: string | null = null) => expect(companyMismatchReason(email, { name, domain }), `${email} for ${name}`).toBeNull()
  const held = (email: string, name: string, domain: string | null = null) => expect(companyMismatchReason(email, { name, domain }), `${email} for ${name}`).not.toBeNull()
  it('accepts the company domain and domains named after the company', () => {
    ok('careers@wolt.com', 'Wolt Enterprises Oy')
    ok('hello@octopus.energy', 'Octopus Energy Group')
    ok('recruitment@backmarket.com', 'Back Market')
    ok('careers@truetalentsolutions.com', 'True Talent Solutions Partners')
    ok('info@shiftbase.com', 'SHIFTBASE B.V.')
    ok('talent@createfuture.com', 'Xdesign', 'createfuture.com')
    ok('jobs@acme.co.uk', 'Acme', 'www.acme.co.uk')
    ok('careers@databricks.com', 'databricks')
  })
  it('holds personal mailboxes and other companies', () => {
    held('recruiter+hof@protonmail.ch', 'MongoDB', 'mongodb.com')
    held('rgilmore@mabr.com', 'Ripple', 'ripple.com')
    held('jobs@recruitingagency.io', 'Stripe', 'stripe.com')
    held('talent@createfuture.com', 'Xdesign')
  })
})

describe('mailbox must be meant for applications (automatic sends)', () => {
  it('accepts recruiting and general mailboxes', () => {
    for (const e of ['careers@feedzai.com', 'recruitment@tripadvisor.com', 'jobs@grafana.com', 'talent@createfuture.com', 'bewerbung@acme.de', 'people@acme.io', 'hr@acme.ie', 'info@superchat.de', 'team@infisical.com', 'hello@octopus.energy', 'contactus@foundationhealth.com']) {
      expect(mailboxPurposeReason(e, 'website'), e).toBeNull()
    }
  })
  it('accepts a person only when the posting names them', () => {
    expect(mailboxPurposeReason('andrei.ivanov@jetbrains.com', 'posting')).toBeNull()
    expect(mailboxPurposeReason('andrei.ivanov@jetbrains.com', 'website')).not.toBeNull()
  })
  it('holds mailboxes for other purposes', () => {
    for (const e of ['officials@n26.com', 'import@twilio.com', 'b2b@wheely.com', 'ir@wolterskluwer.com', 'office-x9@acme.com']) {
      expect(mailboxPurposeReason(e, 'verified'), e).not.toBeNull()
    }
  })
})
