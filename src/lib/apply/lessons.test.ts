import { describe, expect, it, vi, beforeEach } from 'vitest'

interface Row {
  fingerprint: string
  type: string
  kind: string
  host: string | null
  outcome: string | null
  lesson: string
  category: string | null
  pattern: string | null
  blocker: string | null
  hits: number
  createdAt: Date
}

const rows: Row[] = []

/** Just enough of prisma.siteLesson for lessons.ts: upsert by fingerprint, findMany on kind/type/outcome/host. */
vi.mock('@/lib/db', () => ({
  db: {
    siteLesson: {
      upsert: async ({ where, update, create }: { where: { fingerprint: string }; update: { hits: { increment: number } }; create: Omit<Row, 'hits' | 'createdAt'> }) => {
        const r = rows.find((x) => x.fingerprint === where.fingerprint)
        if (r) r.hits += update.hits.increment
        else rows.push({ ...create, hits: 1, createdAt: new Date(Date.now() + rows.length) })
      },
      findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        const notIn = ((where.NOT as { outcome?: { in: string[] } } | undefined)?.outcome?.in ?? []) as string[]
        const out = rows
          .filter((r) => (where.kind === undefined || r.kind === where.kind) && (where.type === undefined || r.type === where.type) && (where.host === undefined || r.host === where.host))
          .filter((r) => (typeof where.outcome === 'string' ? r.outcome === where.outcome : true) && !notIn.includes(r.outcome ?? ''))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        return out.slice(0, take ?? out.length)
      },
    },
  },
}))
vi.mock('@/lib/candidate/load', () => ({ loadCandidateContext: vi.fn() }))

const { alex, sam } = await import('./__fixtures__/personas')
const { fixLessonsFor, keepFixLesson, keepLesson, lessonFingerprint, lessonsFor, SEED_LESSONS } = await import('./lessons')

beforeEach(() => {
  rows.length = 0
})

describe('site lessons', () => {
  it('stores a lesson without the person own details and reads it back with the current person', async () => {
    const a = alex()
    await keepLesson({ kind: 'recruitee', url: 'https://acme.recruitee.com/o/dev/c/new', lesson: 'Type +351 912 345 678 into the phone box and pick Lisbon from the city list; mail goes to alex.rivera@example.com', outcome: 'submitted' }, a)
    expect(rows).toHaveLength(1)
    const stored = rows[0].lesson
    expect(stored).not.toMatch(/912|Lisbon|alex\.rivera/i)
    expect(stored).toContain('{phone}')
    expect(stored).toContain('{city}')
    expect(stored).toContain('{email}')
    expect(rows[0].host).toBe('acme.recruitee.com')

    const forSam = await lessonsFor('recruitee', sam())
    const learned = forSam.find((l) => l.startsWith('Type '))!
    expect(learned).toContain('+234 802 000 0000')
    expect(learned).toContain('Lagos')
    expect(learned).toContain('sam.okafor@example.com')
    const forAlex = await lessonsFor('recruitee', a)
    expect(forAlex).toContain('Type +351 912 345 678 into the phone box and pick Lisbon from the city list; mail goes to alex.rivera@example.com')
  })

  it('bumps hits for a repeat instead of adding a row (one fingerprint per type|kind|host|lesson)', async () => {
    await keepLesson({ kind: 'workday', host: 'acme.wd3.myworkdayjobs.com', lesson: 'Press Save and Continue on each page', outcome: 'submitted' }, alex())
    await keepLesson({ kind: 'workday', host: 'acme.wd3.myworkdayjobs.com', lesson: 'Press Save and Continue on each page', outcome: 'review' }, sam())
    expect(rows).toHaveLength(1)
    expect(rows[0].hits).toBe(2)
    expect(rows[0].fingerprint).toBe(lessonFingerprint('lesson', 'workday', 'acme.wd3.myworkdayjobs.com', 'Press Save and Continue on each page'))
  })

  it('fills the seed templates with the current person', async () => {
    expect(SEED_LESSONS.workday.join(' ')).toContain('{givenName}')
    const forAlex = await lessonsFor('workday', alex())
    expect(forAlex.join(' ')).toContain('Given Name "Alex" and Family Name "Rivera"')
    const forSam = await lessonsFor('workday', sam())
    expect(forSam.join(' ')).toContain('Given Name "Sam" and Family Name "Okafor"')
  })

  it('keeps pinned lessons apart from learned ones and de-duplicates', async () => {
    const a = alex()
    await keepLesson({ kind: 'ashbyhq', host: 'jobs.ashbyhq.com', lesson: 'Open the location list before typing', outcome: 'pinned' }, a)
    for (let i = 0; i < 10; i++) await keepLesson({ kind: 'ashbyhq', host: 'jobs.ashbyhq.com', lesson: `Learned trick ${i}`, outcome: 'submitted' }, a)
    const got = await lessonsFor('ashbyhq', a)
    expect(got).toContain('Open the location list before typing')
    expect(got.filter((l) => l.startsWith('Learned trick'))).toHaveLength(8)
    expect(got).toContain('Learned trick 9')
    expect(got).not.toContain('Learned trick 0')
  })

  it('keeps only second-look fixes that did something, per host', async () => {
    const a = alex()
    await keepFixLesson({ host: 'jobs.example.com', lesson: 'Press Agree in the cookie pop-up first', done: 1 }, a)
    await keepFixLesson({ host: 'jobs.example.com', lesson: 'Nothing worked', done: 0 }, a)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'fix', kind: 'jobs.example.com', outcome: 'fixed' })
    expect(await fixLessonsFor('jobs.example.com', a)).toEqual(['Press Agree in the cookie pop-up first'])
  })
})
