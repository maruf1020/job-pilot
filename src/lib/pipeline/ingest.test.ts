import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { linkCalls: 0, jobCreateCalls: 0 }
  const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
  const db = {
    company: {
      findUnique: vi.fn(async () => ({ id: 'c1', blacklisted: false })),
      create: vi.fn(),
    },
    jobSourceLink: {
      // First pass: no link yet. Second pass: the other source's insert is now visible.
      findUnique: vi.fn(async () => (state.linkCalls++ === 0 ? null : { job: { id: 'j-other', description: 'x', salaryMin: null, visaFlag: null, contactEmail: null, countryCode: 'IE', postedAt: null } })),
      upsert: vi.fn(async () => ({})),
    },
    job: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => {
        state.jobCreateCalls++
        throw p2002()
      }),
      update: vi.fn(async () => ({})),
    },
  }
  return { db, state }
})

vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/sponsors/registers', () => ({ registeredSponsor: vi.fn(async () => null) }))

import { ingestNormalizedJob, isUniqueConflict } from './ingest'

const nj = {
  source: 'freehire' as const,
  externalId: 'fh-1',
  url: 'https://boards.greenhouse.io/acme/jobs/1',
  title: 'Software Engineer',
  company: 'Acme',
  countryCode: 'IE',
  location: 'Dublin',
  remote: false,
  description: 'Build things with TypeScript and React.',
  tags: [],
}

describe('ingestNormalizedJob under concurrent sources', () => {
  beforeEach(() => {
    h.state.linkCalls = 0
    h.state.jobCreateCalls = 0
    vi.clearAllMocks()
  })

  it('turns a lost insert race into an update of the job the other source created', async () => {
    const r = await ingestNormalizedJob(nj)
    expect(r).toEqual({ outcome: 'updated', jobId: 'j-other' })
    expect(h.state.jobCreateCalls).toBe(1)
    expect(h.db.job.update).toHaveBeenCalledTimes(1)
    expect(h.db.jobSourceLink.upsert).toHaveBeenCalledTimes(1)
  })

  it('recognises only unique-key conflicts', () => {
    expect(isUniqueConflict({ code: 'P2002' })).toBe(true)
    expect(isUniqueConflict({ code: 'P2025' })).toBe(false)
    expect(isUniqueConflict(null)).toBe(false)
  })
})
