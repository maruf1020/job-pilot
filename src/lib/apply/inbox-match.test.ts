import { describe, expect, it } from 'vitest'
import { companyKey, isVerificationMail, matchApplication, type ApplicationRef } from './inbox-match'

const sent = new Date('2026-10-01T10:00:00Z')
const apps: ApplicationRef[] = [
  { id: 'stripe', sentAt: sent, title: 'Backend Engineer, Payments', company: 'Stripe', domain: 'stripe.com' },
  { id: 'wolt', sentAt: sent, title: 'Senior Software Engineer, Operations Foundations', company: 'Wolt Enterprises Oy', domain: 'wolt.com' },
  { id: 'hf1', sentAt: sent, title: 'Senior Frontend Engineer', company: 'HelloFresh', domain: null },
  { id: 'hf2', sentAt: sent, title: 'Backend Engineer', company: 'HelloFresh', domain: null },
]
const at = new Date('2026-10-05T10:00:00Z')

describe('matching inbox messages to applications', () => {
  it('matches by the company domain', () => {
    expect(matchApplication({ from: 'Stripe Recruiting <recruiting@stripe.com>', subject: 'Your application', text: 'Thanks', date: at }, apps)?.id).toBe('stripe')
  })
  it('matches ATS mail that names the company', () => {
    const r = matchApplication({ from: 'Wolt <no-reply@us.greenhouse-mail.io>', subject: 'Thank you for applying to Wolt', text: 'We received your application.', date: at }, apps)
    expect(r?.id).toBe('wolt')
  })
  it('uses the job title when the same company has two applications', () => {
    const msg = { from: 'HelloFresh <no-reply@smartrecruiters.com>', subject: 'Your application for Senior Frontend Engineer at HelloFresh', text: '', date: at }
    expect(matchApplication(msg, apps)?.id).toBe('hf1')
    expect(matchApplication({ ...msg, subject: 'Your application at HelloFresh' }, apps)).toBeNull()
  })
  it('ignores job alerts, unrelated senders and mail from before the application', () => {
    expect(matchApplication({ from: 'Stripe <jobs@stripe.com>', subject: 'New jobs for you at Stripe', text: '', date: at }, apps)).toBeNull()
    expect(matchApplication({ from: 'Bank <info@bank.com>', subject: 'Statement', text: 'Your statement', date: at }, apps)).toBeNull()
    expect(matchApplication({ from: 'recruiting@stripe.com', subject: 'Hi', text: '', date: new Date('2026-09-01') }, apps)).toBeNull()
  })
  it('normalises company names and spots verification mail', () => {
    expect(companyKey('Wolt Enterprises Oy')).toBe('wolt enterprises')
    expect(isVerificationMail({ from: 'x', subject: 'Security code for your application to Acme', text: '', date: at })).toBe(true)
  })
})

describe('notification mail is not a reply', () => {
  const sent = new Date('2026-10-01T10:00:00Z')
  const apps: ApplicationRef[] = [{ id: 'cf', sentAt: sent, title: 'Systems Engineer', company: 'Cloudflare', domain: 'cloudflare.com' }]
  it('ignores invoices and other system notifications from the company domain', () => {
    expect(matchApplication({ from: 'Cloudflare <noreply@notify.cloudflare.com>', subject: 'Your invoice is available', text: 'Your latest Cloudflare invoice is ready for review.', date: new Date('2026-10-07') }, apps)).toBeNull()
    expect(matchApplication({ from: 'Cloudflare <noreply@notify.cloudflare.com>', subject: 'New sign-in to your account', text: 'We noticed a new sign-in.', date: new Date('2026-10-07') }, apps)).toBeNull()
  })
  it('still accepts a no-reply message that is about the application', () => {
    expect(matchApplication({ from: 'Cloudflare Careers <noreply@cloudflare.com>', subject: 'Your application to Cloudflare', text: 'Thank you for applying for the Systems Engineer position.', date: new Date('2026-10-07') }, apps)?.id).toBe('cf')
  })
})
