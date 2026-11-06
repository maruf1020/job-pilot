import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { extractBoardRefs } from './careers-discovery'
import { findBoard, probeBoard } from './boards'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
const notFound = () => new Response('not found', { status: 404 })

function routed(routes: Array<[string, () => Response]>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const hit = routes.find(([k]) => url.includes(k))
    return hit ? hit[1]() : notFound()
  }) as typeof fetch
}

const joinPage = (name: string, n: number) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialState: { company: { name }, jobs: { items: Array.from({ length: n }, (_, i) => ({ id: i + 1, idParam: `${i + 1}-dev`, title: 'Developer' })), pagination: { pageCount: 1 } } } } } })}</script>`

describe('probes for the newer ATS types', () => {
  it('BambooHR: a list with jobs is a board; the HTML an unknown slug gets is not', async () => {
    const f = routed([
      ['synthesia.bamboohr.com/careers/list', () => json({ meta: { totalCount: 1 }, result: [{ id: '1', jobOpeningName: 'Engineer' }] })],
      ['empty.bamboohr.com/careers/list', () => json({ meta: { totalCount: 0 }, result: [] })],
      ['nobody.bamboohr.com/careers/list', () => html('<!DOCTYPE html><html></html>')],
    ])
    expect(await probeBoard('bamboohr', 'synthesia', f)).toBeNull()
    expect(await probeBoard('bamboohr', 'empty', f)).toBeUndefined()
    expect(await probeBoard('bamboohr', 'nobody', f)).toBeUndefined()
  })

  it('Breezy: reports the company name; an empty list or 404 is no board', async () => {
    const f = routed([
      ['acme.breezy.hr/json', () => json([{ id: '1', name: 'Dev', company: { name: 'Acme Ltd' } }])],
      ['empty.breezy.hr/json', () => json([])],
    ])
    expect(await probeBoard('breezy', 'acme', f)).toBe('Acme Ltd')
    expect(await probeBoard('breezy', 'empty', f)).toBeUndefined()
    expect(await probeBoard('breezy', 'nobody', f)).toBeUndefined()
  })

  it('Pinpoint: postings.json with data is a board', async () => {
    const f = routed([['thoughtmachine.pinpointhq.com/postings.json', () => json({ data: [{ id: '1', title: 'Dev' }] })]])
    expect(await probeBoard('pinpoint', 'thoughtmachine', f)).toBeNull()
    expect(await probeBoard('pinpoint', 'nobody', f)).toBeUndefined()
  })

  it('JOIN: reads the embedded list and the company name', async () => {
    const f = routed([
      ['join.com/companies/acme', () => html(joinPage('Acme GmbH', 3))],
      ['join.com/companies/quiet', () => html(joinPage('Quiet', 0))],
    ])
    expect(await probeBoard('join', 'acme', f)).toBe('Acme GmbH')
    expect(await probeBoard('join', 'quiet', f)).toBeUndefined()
    expect(await probeBoard('join', 'nobody', f)).toBeUndefined()
  })
})

describe('findBoard with the newer types', () => {
  it('finds a Breezy board by slug and does not need the slow probes', async () => {
    const calls: string[] = []
    const f = routed([['acmerobotics.breezy.hr/json', () => json([{ id: '1', name: 'Dev', company: { name: 'Acme Robotics' } }])]], calls)
    const hit = await findBoard('Acme Robotics', 'acmerobotics.com', f)
    expect(hit).toMatchObject({ atsType: 'breezy', atsSlug: 'acmerobotics', careersUrl: 'https://acmerobotics.breezy.hr', via: 'slug' })
    expect(calls.some((u) => u.includes('workable') || u.includes('join.com'))).toBe(false)
  })

  it('falls back to the slow probes (Workable, JOIN) when every fast one missed', async () => {
    const f = routed([['join.com/companies/acmerobotics', () => html(joinPage('Acme Robotics', 2))]])
    const hit = await findBoard('Acme Robotics', 'acmerobotics.com', f)
    expect(hit).toMatchObject({ atsType: 'join', atsSlug: 'acmerobotics', via: 'slug' })
  })

  it('rejects a board that belongs to a different company', async () => {
    const f = routed([['acmerobotics.breezy.hr/json', () => json([{ id: '1', name: 'Dev', company: { name: 'Totally Unrelated Inc' } }])]])
    expect(await findBoard('Acme Robotics', 'acmerobotics.com', f)).toBeNull()
  })
})

describe('careers page links to the newer types', () => {
  it('extracts BambooHR, Breezy, Pinpoint, JOIN and Workday boards', () => {
    const page = `
      <a href="https://acme.bamboohr.com/careers">Careers</a>
      <a href="https://acme-hr.breezy.hr/">Jobs</a>
      <iframe src="https://acme-pp.pinpointhq.com/"></iframe>
      <a href="https://join.com/companies/acme-join">Join</a>
      <a href="https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers/job/Berlin/Engineer_R1">Workday</a>`
    const keys = extractBoardRefs(page).map((r) => `${r.atsType}:${r.slug}`)
    expect(keys).toEqual(expect.arrayContaining(['bamboohr:acme', 'breezy:acme-hr', 'pinpoint:acme-pp', 'join:acme-join', 'workday:acme/AcmeCareers@wd3']))
  })

  it('finds a Workday board named only inside a script', () => {
    const refs = extractBoardRefs('<script>var u="https://globex.wd5.myworkdayjobs.com/GlobexExternal";</script>')
    expect(refs).toContainEqual({ atsType: 'workday', slug: 'globex/GlobexExternal@wd5' })
  })

  it('does not take the vendors own sites for boards', () => {
    expect(extractBoardRefs('<a href="https://www.bamboohr.com/">x</a> <a href="https://www.breezy.hr/pricing">y</a>')).toEqual([])
  })
})
