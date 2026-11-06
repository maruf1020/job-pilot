import { describe, expect, it } from 'vitest'
import { describeConflict } from './cooldown'

const email = { companyCooldownDays: 15, companyCooldownScope: 'company_country' as const }

describe('company cooldown messages', () => {
  it('explains a recent application and when the company is available again', () => {
    const sentAt = new Date('2026-10-01T09:00:00Z')
    const msg = describeConflict('Stripe', 'IE', { applicationId: 'a', jobTitle: 'Backend Engineer', status: 'SENT', sentAt, sameAddress: false, toEmail: null, availableAt: new Date('2026-10-16T09:00:00Z') }, email)
    expect(msg).toBe('Already applied to Stripe in IE ("Backend Engineer") on 2026-10-01; next application possible from 2026-10-16')
  })
  it('explains a waiting application and omits the country when scope is company-wide', () => {
    const msg = describeConflict('Stripe', 'IE', { applicationId: 'a', jobTitle: 'Frontend Engineer', status: 'QUEUED', sentAt: null, sameAddress: false, toEmail: null, availableAt: null }, { ...email, companyCooldownScope: 'company' })
    expect(msg).toBe('Another application to Stripe ("Frontend Engineer") is already waiting to be sent; only one per 15 days')
  })
})
