import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/email/needs-action', () => ({ needsAction: vi.fn() }))
vi.mock('@/lib/settings/service', () => ({ getSettings: vi.fn() }))

import {
  atsFamily,
  coverage7d,
  pickSample,
  rateBy,
  sampleFields,
  submissionsPerDay,
  wasteCategory,
  wasteSummary,
  type AttemptLite,
} from './apply-engine'

const now = new Date('2026-10-30T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)
const att = (over: Partial<AttemptLite>): AttemptLite => ({
  status: 'SUBMITTED',
  atsType: null,
  lane: null,
  url: null,
  reason: null,
  ...over,
})

describe('waste categories', () => {
  it('names the non-form reason an attempt was spent on', () => {
    expect(wasteCategory('A CAPTCHA needs a person. Solve it in the apply browser')).toBe('captcha')
    expect(wasteCategory('page.goto: net::ERR_NAME_NOT_RESOLVED at https://x.y')).toBe('network')
    expect(wasteCategory('Worker restarted during the attempt')).toBe('worker')
    expect(wasteCategory('Your Chrome: moved to your Chrome for your logins')).toBe('your-chrome')
    expect(wasteCategory('Your Chrome: held because you paused auto-submitting')).toBe('paused')
    expect(wasteCategory('Your Chrome: not a Software Engineer / Senior Software Engineer title')).toBe(
      'not-a-fit',
    )
    expect(wasteCategory('The posting looks closed or removed')).toBe('closed')
    expect(wasteCategory('Could not fill: "City" (invalid)')).toBeNull()
    expect(wasteCategory(null)).toBeNull()
  })
  it('counts wasted attempts against all finished ones, never submissions', () => {
    const s = wasteSummary([
      att({}),
      att({ status: 'CANCELLED', reason: 'A CAPTCHA needs a person' }),
      att({ status: 'FAILED', reason: 'page.goto: net::ERR_NAME_NOT_RESOLVED' }),
      att({ status: 'NEEDS_HUMAN', reason: 'Needs your answer: notice period' }),
      att({ status: 'RUNNING' }),
    ])
    expect(s).toMatchObject({ attempts: 4, wasted: 2, share: 50 })
    expect(s.byCategory.map((c) => c.category).sort()).toEqual(['captcha', 'network'])
  })
})

describe('success per ATS family and lane', () => {
  it('reads the family from the agent first, then the URL', () => {
    expect(atsFamily('Greenhouse', null)).toBe('greenhouse')
    expect(atsFamily(null, 'https://jobs.ashbyhq.com/acme/123/application')).toBe('ashby')
    expect(atsFamily(null, 'https://acme.wd3.myworkdayjobs.com/en-US/careers/job/1')).toBe('workday')
    expect(atsFamily(null, 'https://careers.acme.com/jobs/1')).toBe('other')
  })
  it('rates submitted out of submitted, needing you and failed (cancelled is waste, not a try at the form)', () => {
    const rows = [
      att({ atsType: 'lever' }),
      att({ atsType: 'lever', status: 'FAILED' }),
      att({ atsType: 'lever', status: 'CANCELLED' }),
      att({ atsType: 'ashby' }),
    ]
    const byFamily = rateBy(rows, (r) => atsFamily(r.atsType, r.url))
    expect(byFamily[0]).toMatchObject({
      key: 'lever',
      attempts: 3,
      submitted: 1,
      failed: 1,
      cancelled: 1,
      successPct: 50,
    })
    expect(byFamily.find((r) => r.key === 'ashby')?.successPct).toBe(100)
    expect(rateBy([att({ status: 'CANCELLED' })], () => 'x')[0].successPct).toBeNull()
  })
})

describe('submissions per day', () => {
  it('buckets by UTC day and by how it was sent, oldest day first', () => {
    const days = submissionsPerDay(
      [
        { sentAt: daysAgo(0), submittedVia: 'agent' },
        { sentAt: daysAgo(0), submittedVia: 'manual' },
        { sentAt: daysAgo(1), submittedVia: null },
        { sentAt: daysAgo(30), submittedVia: 'agent' },
      ],
      3,
      now,
    )
    expect(days.map((d) => d.day)).toEqual(['2026-10-28', '2026-10-29', '2026-10-30'])
    expect(days[2]).toMatchObject({ agent: 1, manual: 1, email: 0 })
    expect(days[1]).toMatchObject({ email: 1 })
  })
})

describe('applied within 7 days', () => {
  it('only judges jobs that had a full week, and counts applications sent within it', () => {
    const c = coverage7d(
      [
        { firstSeenAt: daysAgo(10), sentAt: daysAgo(8) },
        { firstSeenAt: daysAgo(20), sentAt: daysAgo(5) },
        { firstSeenAt: daysAgo(12), sentAt: null },
        { firstSeenAt: daysAgo(3), sentAt: daysAgo(2) },
        { firstSeenAt: daysAgo(60), sentAt: daysAgo(59) },
      ],
      now,
    )
    expect(c).toEqual({ fitJobs: 3, appliedWithin7d: 1, share: 33 })
    expect(coverage7d([], now).share).toBeNull()
  })
})

describe('sample', () => {
  it('picks n distinct rows', () => {
    const rows = Array.from({ length: 30 }, (_, i) => i)
    const s = pickSample(rows, 10, () => 0.42)
    expect(s).toHaveLength(10)
    expect(new Set(s).size).toBe(10)
    expect(pickSample([1, 2], 10)).toHaveLength(2)
  })
  it('turns stored answers into label and value, files by name', () => {
    expect(
      sampleFields([
        { key: 'f1', label: 'First name', value: 'Alex', source: 'bank' },
        { key: 'f2', label: 'CV', file: 'cv.pdf', value: 'x', source: 'resume' },
        null,
        'junk',
      ]),
    ).toEqual([
      { label: 'First name', value: 'Alex', source: 'bank' },
      { label: 'CV', value: 'cv.pdf', source: 'resume' },
    ])
    expect(sampleFields(null)).toEqual([])
  })
})
