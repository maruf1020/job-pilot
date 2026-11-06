import { describe, expect, it } from 'vitest'
import { DEFAULT_SEARCH } from '@/lib/settings/schema'
import { boardFromUrl } from '@/lib/sponsors/board-registry'
import { atsBoardUrl, fetchCompanyBoard, parseJoinCompanyPage } from './ats'
import type { AtsCompanyRef, SourceContext } from './types'

/**
 * BambooHR, Breezy, Pinpoint and JOIN. The payloads below are trimmed copies of what the public boards answered
 * (synthesia.bamboohr.com, breezy.breezy.hr, thoughtmachine.pinpointhq.com, join.com/companies/join).
 */

const company = (atsType: AtsCompanyRef['atsType'], atsSlug: string): AtsCompanyRef => ({ id: 'c1', name: 'Acme', atsType, atsSlug, knownSponsor: false })

function ctxWith(fetchImpl: typeof fetch): SourceContext {
  // A developer search: the boards keep engineering titles only.
  return { search: { ...DEFAULT_SEARCH, profession: 'software' as const }, env: {}, fetch: fetchImpl, log: () => undefined }
}

function routed(routes: Record<string, { body: unknown; type?: string }>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return new Response('not found', { status: 404 })
    const { body, type } = routes[key]
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': type ?? 'application/json' } })
  }) as typeof fetch
}

const BAMBOO_LIST = {
  meta: { totalCount: 3 },
  result: [
    { id: '15', jobOpeningName: 'IT Security Engineer', departmentId: '18251', departmentLabel: 'IT', employmentStatusLabel: 'Full-Time', employmentType: null, location: { city: 'Mayfair', state: 'London, City of' }, atsLocation: { country: null, state: null, province: null, city: null }, isRemote: null, locationType: '0' },
    { id: '20', jobOpeningName: 'Software Engineer', departmentId: '18264', departmentLabel: 'Product', employmentStatusLabel: 'Full-Time', employmentType: null, location: { city: 'Berlin', state: 'Brandenburg' }, atsLocation: { country: null, state: null, province: null, city: null }, isRemote: null, locationType: '0' },
    { id: '21', jobOpeningName: 'Sales Development Representative', departmentId: '18249', departmentLabel: 'Sales', employmentStatusLabel: 'Full-Time', employmentType: null, location: { city: 'London', state: null }, isRemote: null, locationType: '0' },
  ],
}
const BAMBOO_DETAIL_20 = {
  meta: {},
  result: {
    jobOpening: {
      jobOpeningShareUrl: 'https://synthesia.bamboohr.com/careers/20',
      jobOpeningName: 'Software Engineer',
      location: { city: 'Berlin', state: 'Brandenburg', postalCode: '10117', addressCountry: 'Germany' },
      description: '<p><strong>About Us</strong></p><p>We build with TypeScript and React.</p>',
      datePosted: '2025-07-14',
    },
  },
}

describe('BambooHR', () => {
  it('reads the careers list and the detail of each engineering posting', async () => {
    const calls: string[] = []
    const f = routed({ '/careers/list': { body: BAMBOO_LIST }, '/careers/20/detail': { body: BAMBOO_DETAIL_20 }, '/careers/15/detail': { body: { result: { jobOpening: { location: { city: 'Mayfair', addressCountry: 'United Kingdom' } } } } } }, calls)
    const r = await fetchCompanyBoard(company('bamboohr', 'synthesia'), ctxWith(f), 100_000)
    expect(r.jobs.map((j) => j.title).sort()).toEqual(['IT Security Engineer', 'Software Engineer'])
    const se = r.jobs.find((j) => j.title === 'Software Engineer')!
    expect(se).toMatchObject({ externalId: 'bamboohr:synthesia:20', url: 'https://synthesia.bamboohr.com/careers/20', countryCode: 'DE', source: 'ats' })
    expect(se.description).toContain('TypeScript and React')
    expect(r.requests).toBe(3)
    expect(calls[0]).toBe('https://synthesia.bamboohr.com/careers/list')
  })

  it('skips the detail call of postings already in the database', async () => {
    const calls: string[] = []
    const f = routed({ '/careers/list': { body: BAMBOO_LIST } }, calls)
    const r = await fetchCompanyBoard(company('bamboohr', 'synthesia'), ctxWith(f), 100_000, (id) => id.startsWith('bamboohr:synthesia:'))
    expect(r.jobs).toEqual([])
    expect(r.known).toEqual(['bamboohr:synthesia:15', 'bamboohr:synthesia:20'])
    expect(calls).toHaveLength(1)
  })

  it('fails for a company without a BambooHR careers list (the site answers HTML)', async () => {
    const f = routed({ '/careers/list': { body: '<!DOCTYPE html><html></html>', type: 'text/html' } })
    await expect(fetchCompanyBoard(company('bamboohr', 'nobody'), ctxWith(f), 30)).rejects.toThrow()
  })
})

const BREEZY = [
  {
    id: '98323abf2296',
    friendly_id: '98323abf2296-senior-software-engineer',
    name: 'Senior Software Engineer',
    url: 'https://acme.breezy.hr/p/98323abf2296-senior-software-engineer',
    published_date: '2026-10-15T14:37:22.684Z',
    type: { id: 'fullTime', name: 'Full-Time' },
    location: { country: { name: 'Germany', id: 'DE' }, state: { id: 'BE', name: 'Berlin' }, city: 'Berlin', primary: true, is_remote: false, name: 'Berlin, BE' },
    department: 'Engineering',
    company: { name: 'Acme', friendly_id: 'acme' },
    locations: [],
  },
  {
    id: '4f4620daf613',
    friendly_id: '4f4620daf613-frontend-developer',
    name: 'Frontend Developer',
    url: 'https://acme.breezy.hr/p/4f4620daf613-frontend-developer',
    published_date: '2026-10-01T10:00:00.000Z',
    type: { id: 'fullTime', name: 'Full-Time' },
    location: { country: { name: 'United States', id: 'US' }, city: 'Remote', is_remote: true, name: 'Remote, US' },
    department: 'Engineering',
    company: { name: 'Acme', friendly_id: 'acme' },
    locations: [],
  },
  { id: '1', friendly_id: '1-office-manager', name: 'Office Manager', url: 'https://acme.breezy.hr/p/1-office-manager', location: { name: 'Berlin' }, company: { name: 'Acme' } },
]

describe('Breezy HR', () => {
  it('reads the positions JSON with the ISO country and the remote flag', async () => {
    const r = await fetchCompanyBoard(company('breezy', 'acme'), ctxWith(routed({ 'acme.breezy.hr/json': { body: BREEZY } })), 100_000)
    expect(r.jobs).toHaveLength(2)
    expect(r.jobs[0]).toMatchObject({ externalId: 'breezy:acme:98323abf2296-senior-software-engineer', title: 'Senior Software Engineer', countryCode: 'DE', remote: false, location: 'Berlin, BE' })
    expect(r.jobs[1]).toMatchObject({ countryCode: 'US', remote: true })
    expect(r.requests).toBe(1)
  })
  it('an empty board is a board with no jobs; an unknown one is an error', async () => {
    expect((await fetchCompanyBoard(company('breezy', 'acme'), ctxWith(routed({ '/json': { body: [] } })), 30)).jobs).toEqual([])
    await expect(fetchCompanyBoard(company('breezy', 'nobody'), ctxWith(routed({})), 30)).rejects.toThrow()
  })
})

const PINPOINT = {
  data: [
    {
      id: '348371',
      title: 'Senior Full Stack Engineer',
      description: '<div>We use <b>TypeScript</b> and Node.</div>',
      key_responsibilities: '<div>Build services</div>',
      skills_knowledge_expertise: '<div>React</div>',
      employment_type_text: 'Full Time',
      workplace_type: 'remote',
      url: 'https://acme.pinpointhq.com/en/postings/e6a98db1-2b29',
      path: '/en/postings/e6a98db1-2b29',
      job: { department: { name: 'Engineering' } },
      location: { id: '54607', city: null, name: 'London', province: null },
    },
    { id: '2', title: 'Head of DEI', description: '<div>x</div>', url: 'https://acme.pinpointhq.com/en/postings/2', job: { department: { name: 'People' } }, location: { name: 'London' } },
  ],
}

describe('Pinpoint', () => {
  it('reads postings.json with full descriptions', async () => {
    const r = await fetchCompanyBoard(company('pinpoint', 'acme'), ctxWith(routed({ 'acme.pinpointhq.com/postings.json': { body: PINPOINT } })), 100_000)
    expect(r.jobs).toHaveLength(1)
    expect(r.jobs[0]).toMatchObject({ externalId: 'pinpoint:acme:348371', title: 'Senior Full Stack Engineer', countryCode: 'GB', remote: true, url: 'https://acme.pinpointhq.com/en/postings/e6a98db1-2b29' })
    expect(r.jobs[0].description).toContain('TypeScript')
    expect(r.jobs[0].description).toContain('React')
  })
  it('an unknown board is an error', async () => {
    await expect(fetchCompanyBoard(company('pinpoint', 'nobody'), ctxWith(routed({})), 30)).rejects.toThrow()
  })
})

function joinHtml(jobs: unknown[], pageCount = 1, name = 'Acme'): string {
  const data = { props: { pageProps: { initialState: { company: { id: 1, name }, jobs: { items: jobs, pagination: { page: 1, pageCount, pageSize: 5, total: jobs.length } } } } } }
  return `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`
}
const JOIN_JOBS = [
  { idParam: '16805344-senior-software-engineer', id: 16805344, remoteType: null, title: 'Senior Software Engineer', createdAt: '2026-10-09T10:49:25.699Z', workplaceType: 'HYBRID', city: { cityName: 'Barcelona', countryName: 'Spain' }, employmentType: { name: 'Employee' }, category: { name: 'Engineering' }, country: { iso3166: 'ES' } },
  { idParam: '16805345-growth-marketing-manager', id: 16805345, remoteType: null, title: 'Growth Marketing Manager', createdAt: '2026-10-09T10:49:25.699Z', workplaceType: 'HYBRID', city: { cityName: 'Barcelona', countryName: 'Spain' }, category: { name: 'Marketing' }, country: { iso3166: 'ES' } },
  { idParam: '16805346-backend-developer', id: 16805346, title: 'Backend Developer', createdAt: '2026-10-10T10:00:00.000Z', workplaceType: 'REMOTE', city: null, country: { iso3166: null } },
]

describe('JOIN', () => {
  it('reads the job list embedded in the company page', () => {
    const page = parseJoinCompanyPage(joinHtml(JOIN_JOBS, 2))
    expect(page).toMatchObject({ name: 'Acme', pageCount: 2 })
    expect(page?.jobs).toHaveLength(3)
    expect(parseJoinCompanyPage('<html>no data</html>')).toBeNull()
    expect(parseJoinCompanyPage('<script id="__NEXT_DATA__" type="application/json">{broken</script>')).toBeNull()
  })

  it('maps jobs with their ISO country and remote type, reading every page', async () => {
    const calls: string[] = []
    const f = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(joinHtml(JOIN_JOBS, 2), { status: 200 })
    }) as typeof fetch
    const r = await fetchCompanyBoard(company('join', 'acme'), ctxWith(f), 100_000)
    expect(calls).toEqual(['https://join.com/companies/acme', 'https://join.com/companies/acme?page=2'])
    expect(r.requests).toBe(2)
    const titles = r.jobs.map((j) => j.title)
    expect(titles).toContain('Senior Software Engineer')
    expect(titles).not.toContain('Growth Marketing Manager')
    const se = r.jobs.find((j) => j.title === 'Senior Software Engineer')!
    expect(se).toMatchObject({ externalId: 'join:acme:16805344', url: 'https://join.com/companies/acme/16805344-senior-software-engineer', countryCode: 'ES', location: 'Barcelona, Spain', remote: false })
    expect(r.jobs.find((j) => j.title === 'Backend Developer')).toMatchObject({ remote: true })
  })

  it('a company page that does not exist is an error', async () => {
    const f = (async () => new Response('not found', { status: 404 })) as typeof fetch
    await expect(fetchCompanyBoard(company('join', 'nobody'), ctxWith(f), 30)).rejects.toThrow(/404/)
  })
})

describe('board URLs and links', () => {
  it('builds the public board address of each type', () => {
    expect(atsBoardUrl('bamboohr', 'acme')).toBe('https://acme.bamboohr.com/careers')
    expect(atsBoardUrl('breezy', 'acme')).toBe('https://acme.breezy.hr')
    expect(atsBoardUrl('pinpoint', 'acme')).toBe('https://acme.pinpointhq.com')
    expect(atsBoardUrl('join', 'acme')).toBe('https://join.com/companies/acme')
  })
  it.each([
    ['https://synthesia.bamboohr.com/careers/20', 'bamboohr', 'synthesia'],
    ['https://acme.breezy.hr/p/98323abf2296-senior-software-engineer', 'breezy', 'acme'],
    ['https://thoughtmachine.pinpointhq.com/en/postings/e6a98db1', 'pinpoint', 'thoughtmachine'],
    ['https://join.com/companies/acme/16805344-senior-software-engineer', 'join', 'acme'],
    ['https://join.com/companies/acme', 'join', 'acme'],
  ])('%s names a board', (url, atsType, slug) => {
    expect(boardFromUrl(url)).toEqual({ atsType, slug })
  })
  it('ignores the vendors own pages', () => {
    expect(boardFromUrl('https://www.bamboohr.com/hr-software/')).toBeNull()
    expect(boardFromUrl('https://app.breezy.hr/signin')).toBeNull()
    expect(boardFromUrl('https://join.com/pricing')).toBeNull()
  })
})
