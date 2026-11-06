import { describe, expect, it } from 'vitest'
import { currentStage, deriveNextAction } from '@/lib/applications/ongoing'
import type { LeadItem } from '@/lib/email/needs-action'
import { groupNextSteps } from '@/lib/inbox/sync'
import { groupBlockedJobs, locationSentence, reasonCategory } from './not-hiring-abroad'

const lead = (over: Partial<LeadItem> & { company: string; title?: string }): LeadItem => ({
  messageId: `m-${over.company}-${over.title ?? 'x'}`,
  applicationId: `a-${over.company}-${over.title ?? 'x'}`,
  classification: 'INTERVIEW_REQUEST',
  from: 'hr@example.org',
  subject: 'Next steps',
  receivedAt: '2026-10-29T10:00:00.000Z',
  ageDays: 0,
  summary: 'Wants a 30 minute call',
  suggestedNextAction: null,
  applyUrl: null,
  contact: null,
  questions: [],
  proposedTimes: [],
  job: { id: 'j', title: over.title ?? 'Engineer', companyName: over.company, countryCode: 'IE', url: 'https://x', atsType: null },
  status: 'REPLIED',
  answered: false,
  hasDraft: false,
  ...over,
})

describe('groupNextSteps', () => {
  it('keeps one row per company and counts the other roles', () => {
    const rows = groupNextSteps([lead({ company: 'Stripe', title: 'Frontend' }), lead({ company: 'stripe ', title: 'Backend' }), lead({ company: 'Alan', classification: 'NEEDS_INFO', summary: null, subject: 'Quick question' })])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ company: 'Stripe', title: 'Frontend', otherRoles: 1, ask: 'Wants a 30 minute call' })
    expect(rows[1]).toMatchObject({ company: 'Alan', ask: 'Quick question', classification: 'NEEDS_INFO' })
  })
})

describe('deriveNextAction', () => {
  const now = new Date('2026-10-30T00:00:00Z')
  const base = { status: 'REPLIED', stages: [], lastInbound: null, lastOutboundAt: new Date('2026-10-20T09:00:00Z'), lastActivityAt: new Date('2026-10-21T09:00:00Z'), now }
  it('asks for a reply when their latest message is unanswered', () => {
    const a = deriveNextAction({ ...base, lastInbound: { at: new Date('2026-10-28T09:00:00Z'), classification: 'INTERVIEW_REQUEST', handled: false } })
    expect(a).toMatchObject({ kind: 'reply', label: 'Reply: book the interview' })
  })
  it('does not ask for a reply after an auto-reply or once answered', () => {
    expect(deriveNextAction({ ...base, lastInbound: { at: new Date('2026-10-28T09:00:00Z'), classification: 'AUTO_REPLY', handled: false } }).kind).toBe('waiting')
    expect(deriveNextAction({ ...base, lastInbound: { at: new Date('2026-10-18T09:00:00Z'), classification: 'POSITIVE', handled: false } }).kind).toBe('waiting')
  })
  it('prepares for a booked stage with its date', () => {
    const a = deriveNextAction({ ...base, status: 'INTERVIEW', stages: [{ name: 'Skill test', status: 'done' }, { name: 'Tech interview', status: 'current', at: '2026-11-03T10:00:00Z' }] })
    expect(a).toMatchObject({ kind: 'prepare', label: 'Prepare for Tech interview on 3 Nov' })
  })
  it('handles offers and plain waiting', () => {
    expect(deriveNextAction({ ...base, status: 'OFFER' }).kind).toBe('offer')
    expect(deriveNextAction(base)).toMatchObject({ kind: 'waiting', label: 'Waiting for them since 20 Oct' })
  })
  it('picks the current stage, else the next to do, else the last done', () => {
    expect(currentStage([{ name: 'A', status: 'done' }, { name: 'B', status: 'todo' }])?.name).toBe('B')
    expect(currentStage([{ name: 'A', status: 'done' }, { name: 'B', status: 'done' }])?.name).toBe('B')
    expect(currentStage([])).toBeNull()
  })
})

describe('not hiring from abroad', () => {
  it('labels the work-rights and location reasons only', () => {
    expect(reasonCategory('Canada: the posting asks for existing work rights ("must be legally eligible")')).toBe('Asks for existing work rights')
    expect(reasonCategory('Employer says no visa sponsorship ("we do not sponsor")')).toBe('Says it does not sponsor visas')
    expect(reasonCategory('Employer states no visa sponsorship')).toBe('Says it does not sponsor visas')
    expect(reasonCategory('United States: the posting does not say the employer sponsors a visa')).toBe('No sponsorship stated (outside Europe)')
    expect(reasonCategory('Outside Europe (India)')).toBe('Outside your target countries')
    expect(reasonCategory('Title contains "java"')).toBeNull()
  })
  it('groups jobs per company, biggest first', () => {
    const d = new Date('2026-10-29T00:00:00Z')
    const rows = [
      { companyId: 'c1', companyName: 'Acme', filterReason: 'Employer says no visa sponsorship', firstSeenAt: d, title: 'Frontend' },
      { companyId: 'c1', companyName: 'Acme', filterReason: 'Employer says no visa sponsorship', firstSeenAt: d, title: 'Backend' },
      { companyId: 'c1', companyName: 'Acme', filterReason: 'Outside Europe (India)', firstSeenAt: d, title: 'Frontend' },
      { companyId: 'c2', companyName: 'Beta', filterReason: 'Canada: the posting asks for existing work rights', firstSeenAt: d, title: 'Dev' },
      { companyId: 'c3', companyName: 'Gamma', filterReason: 'Title contains "php"', firstSeenAt: d, title: 'PHP Dev' },
    ]
    const g = groupBlockedJobs([...rows, ...['A', 'B', 'C', 'D'].map((t) => ({ companyId: 'c4', companyName: 'Delta', filterReason: 'Outside Europe (India)', firstSeenAt: d, title: t }))])
    // A company that refused sponsorship itself ranks above one that is only outside the user's countries.
    expect(g.map((c) => c.company)).toEqual(['Acme', 'Beta', 'Delta'])
    expect(g[0]).toMatchObject({ jobs: 3, reason: 'Says it does not sponsor visas', sampleTitles: ['Frontend', 'Backend'] })
  })
  it('finds the sentence that turns down the location', () => {
    expect(locationSentence('Only hiring in Germany.', 'x')).toBe('Only hiring in Germany.')
    expect(locationSentence(null, 'Thanks for applying. Unfortunately we cannot sponsor visas for this role. Best of luck.')).toBe('Unfortunately we cannot sponsor visas for this role.')
  })
})
