import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SEARCH } from '@/lib/settings/schema'
import { sameTitle } from '@/lib/pipeline/employer-links'
import { atsAdapter, fetchCompanyBoard, leverSlug, parsePersonioXml, parseTeamtailorRss, xmlText } from './ats'
import { _resetBundesagenturBlock, baCandidates, bundesagenturAdapter, normalizeBaPosting } from './bundesagentur'
import { firstLine, firstLink, normalizeHnPost, parseHeader } from './hn'
import { locationAllowed, remoteOpen } from './region-filter'
import type { AtsCompanyRef, SourceContext } from './types'

const company = (atsType: AtsCompanyRef['atsType'], atsSlug: string): AtsCompanyRef => ({ id: 'c1', name: 'Acme', atsType, atsSlug, knownSponsor: false })

function ctxWith(fetchImpl: typeof fetch, extra: Partial<SourceContext> = {}): SourceContext {
  return { search: DEFAULT_SEARCH, env: {}, fetch: fetchImpl, log: () => undefined, ...extra }
}

function jsonFetch(routes: Record<string, unknown>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return new Response('not found', { status: 404 })
    const body = routes[key]
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })
  }) as typeof fetch
}

const PERSONIO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
<position>
    <id>2082337</id>
    <office>Berlin</office>
    <department>Engineering</department>
    <name>Senior Frontend Engineer (m/w/d)</name>
    <jobDescriptions>
      <jobDescription><name>Your tasks</name><value><![CDATA[<p>Build React &amp; TypeScript apps</p>]]></value></jobDescription>
    </jobDescriptions>
    <employmentType>permanent</employmentType>
    <seniority>experienced</seniority>
    <keywords>react,typescript</keywords>
    <createdAt>2026-10-20T09:51:48+00:00</createdAt>
</position>
<position>
    <id>99</id>
    <office>Berlin</office>
    <name>Office Manager</name>
    <createdAt>2026-10-20T09:51:48+00:00</createdAt>
</position>
</workzag-jobs>`

const TEAMTAILOR_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel>
<item>
  <title>Back-end Engineer</title>
  <description>&lt;p&gt;Node.js and PostgreSQL&lt;/p&gt;</description>
  <pubDate>Thu, 29 Oct 2026 09:03:55 +0100</pubDate>
  <link>https://yousign.teamtailor.com/jobs/8606426-back-end-engineer</link>
  <remoteStatus>hybrid</remoteStatus>
  <guid>fca45b67</guid>
  <tt:locations><tt:location><tt:name>Paris</tt:name><tt:city>Paris</tt:city><tt:country>France</tt:country></tt:location></tt:locations>
  <tt:department>Engineering</tt:department>
</item>
<item>
  <title>Revenue Operations</title>
  <link>https://yousign.teamtailor.com/jobs/1-revenue</link>
</item>
</channel></rss>`

describe('Personio and Teamtailor feeds', () => {
  it('reads Personio XML positions with engineering titles', () => {
    const jobs = parsePersonioXml(PERSONIO_XML, company('personio', 'acme'))
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ externalId: 'personio:acme:2082337', title: 'Senior Frontend Engineer (m/w/d)', countryCode: 'DE', url: 'https://acme.jobs.personio.com/job/2082337?language=en' })
    expect(jobs[0].description).toContain('Build React & TypeScript apps')
  })
  it('reads Teamtailor RSS items', () => {
    const jobs = parseTeamtailorRss(TEAMTAILOR_RSS, company('teamtailor', 'yousign'))
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ externalId: 'teamtailor:yousign:8606426', countryCode: 'FR', location: 'Paris, France', url: 'https://yousign.teamtailor.com/jobs/8606426-back-end-engineer' })
    expect(jobs[0].description).toContain('Node.js and PostgreSQL')
  })
  it('unwraps CDATA and entities', () => {
    expect(xmlText('<a><![CDATA[<b>x</b>]]></a>', 'a')).toBe('<b>x</b>')
    expect(xmlText('<a>R&amp;D</a>', 'a')).toBe('R&D')
  })
  it('marks Lever EU boards', () => {
    expect(leverSlug('acme@eu')).toEqual({ slug: 'acme', eu: true })
    expect(leverSlug('acme')).toEqual({ slug: 'acme', eu: false })
  })
})

describe('ATS boards skip postings already in the database', () => {
  const ghBody = { jobs: [1, 2, 3].map((id) => ({ id, title: `Software Engineer ${id}`, updated_at: new Date().toISOString(), absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`, location: { name: 'Dublin, Ireland' }, content: 'x' })) }

  it('returns only new postings and refreshes the known ones', async () => {
    const touched: string[][] = []
    const ctx = ctxWith(jsonFetch({ 'boards-api.greenhouse.io/v1/boards/acme': ghBody }), {
      atsCompanies: [company('greenhouse', 'acme')],
      atsKnown: new Map([['greenhouse:acme:1', 'job1'], ['greenhouse:acme:2', 'job2']]),
      atsTouchKnown: async (ids, jobIds) => {
        touched.push([...ids, ...jobIds])
      },
    })
    const r = await atsAdapter.fetch({ query: '', maxDaysOld: 45, page: 1 }, ctx)
    expect(r.jobs.map((j) => j.externalId)).toEqual(['greenhouse:acme:3'])
    expect(touched).toEqual([['greenhouse:acme:1', 'greenhouse:acme:2', 'job1', 'job2']])
  })

  it('reads every posting when the known list is off', async () => {
    const ctx = ctxWith(jsonFetch({ 'boards-api.greenhouse.io/v1/boards/acme': ghBody }), { atsCompanies: [company('greenhouse', 'acme')], atsKnown: null })
    const r = await atsAdapter.fetch({ query: '', maxDaysOld: 45, page: 1 }, ctx)
    expect(r.jobs).toHaveLength(3)
  })

  it('skips SmartRecruiters detail calls for known postings', async () => {
    const calls: string[] = []
    const now = new Date().toISOString()
    const f = jsonFetch(
      {
        '/postings?limit=100': { content: [{ id: 'a', name: 'Frontend Engineer', releasedDate: now }, { id: 'b', name: 'Backend Engineer', releasedDate: now }] },
        '/postings/b': { applyUrl: 'https://jobs.smartrecruiters.com/Acme/b', jobAd: { sections: { d: { title: 'About', text: 'Node' } } } },
      },
      calls,
    )
    const r = await fetchCompanyBoard(company('smartrecruiters', 'Acme'), ctxWith(f), 45, (id) => id === 'smartrecruiters:Acme:a')
    expect(r.jobs.map((j) => j.externalId)).toEqual(['smartrecruiters:Acme:b'])
    expect(r.known).toEqual(['smartrecruiters:Acme:a'])
    expect(calls.some((u) => u.includes('/postings/a'))).toBe(false)
    expect(calls[0]).toContain('releasedAfter=')
  })
})

describe('region filter for sources', () => {
  const withUs = { includeUk: true, outsideEurope: ['US' as const] }
  it('keeps Europe and unknown places, drops other places', () => {
    expect(locationAllowed('Dublin, Ireland')).toBe(true)
    expect(locationAllowed('Somewhere')).toBe(true)
    expect(locationAllowed('Bangalore, India')).toBe(false)
    expect(locationAllowed('Austin, TX')).toBe(false)
  })
  it('keeps countries outside Europe that are switched on', () => {
    expect(locationAllowed('Austin, TX', withUs)).toBe(true)
    expect(locationAllowed('Toronto, ON', withUs)).toBe(false)
    expect(locationAllowed('London, UK', { includeUk: false, outsideEurope: [] })).toBe(false)
  })
  it('reads remote restrictions', () => {
    expect(remoteOpen('Europe')).toBe(true)
    expect(remoteOpen('Worldwide')).toBe(true)
    expect(remoteOpen('Remote')).toBe(true)
    expect(remoteOpen('USA Only')).toBe(false)
    expect(remoteOpen('USA Only', withUs)).toBe(true)
    expect(remoteOpen('Americas')).toBe(false)
    expect(remoteOpen('Canada, United Kingdom')).toBe(true)
  })
})

describe('Hacker News "Who is hiring"', () => {
  const post = (text: string, id = 1) => ({ id, text, created_at: new Date().toISOString() })
  it('reads the first line', () => {
    const html = 'Acme (YC W21) | Senior Full-Stack Engineer | Berlin or REMOTE (EU) | VISA | <a href="https:&#x2F;&#x2F;acme.dev&#x2F;jobs" rel="nofollow">https://acme.dev/jobs</a><p>We use TypeScript and React.'
    expect(firstLine(html)).toContain('Acme (YC W21) | Senior Full-Stack Engineer')
    expect(firstLink(html)).toBe('https://acme.dev/jobs')
    expect(parseHeader(firstLine(html))).toMatchObject({ company: 'Acme', title: 'Senior Full-Stack Engineer', location: 'Berlin or REMOTE (EU)' })
  })
  it('keeps stack posts with visa words or one of your places', () => {
    const keep = normalizeHnPost(post('Acme | Senior Engineer | Berlin | VISA<p>TypeScript, React, Node.js. We sponsor visas.'), DEFAULT_SEARCH, 0)
    expect(keep).toMatchObject({ source: 'hn', company: 'Acme', countryCode: 'DE', url: 'https://news.ycombinator.com/item?id=1' })
    expect(normalizeHnPost(post('Acme | Engineer | Amsterdam<p>React and TypeScript.'), DEFAULT_SEARCH, 0)).not.toBeNull()
  })
  it('picks the preferred role when a post lists several', () => {
    expect(parseHeader('Acme | Senior Platform & DevOps Engineer, Senior Frontend Engineer, Data Engineer | Berlin', /front[- ]?end/i).title).toBe('Senior Frontend Engineer')
    expect(parseHeader('Acme | Senior Platform & DevOps Engineer, Senior Frontend Engineer | Berlin').title).toBe('Senior Platform & DevOps Engineer')
  })
  it('finds the place in brackets after the company name', () => {
    expect(parseHeader('PrairieLearn (Remote US) — Full-Stack Software Engineer — TypeScript / Postgres')).toMatchObject({ company: 'PrairieLearn', location: 'Remote US' })
    expect(normalizeHnPost(post('PrairieLearn (Remote US) — Full-Stack Software Engineer — TypeScript<p>No visa needed for US citizens.'), DEFAULT_SEARCH, 0)).toBeNull()
  })
  it('stores only countries you apply in for remote feeds', async () => {
    const { remoteCountry } = await import('./region-filter')
    expect(remoteCountry('Europe, Canada')).toBeUndefined()
    expect(remoteCountry('Germany')).toBe('DE')
    expect(remoteCountry('USA Only', { includeUk: true, outsideEurope: ['US'] })).toBe('US')
  })
  it('drops posts outside your places, off-stack posts and old posts', () => {
    expect(normalizeHnPost(post('Acme | Engineer | San Francisco, CA | VISA<p>TypeScript. Visa sponsorship available.'), DEFAULT_SEARCH, 0)).toBeNull()
    expect(normalizeHnPost(post('Acme | Engineer | REMOTE (US)<p>TypeScript, React.'), DEFAULT_SEARCH, 0)).toBeNull()
    expect(normalizeHnPost(post('Acme | Rust Engineer | Berlin | VISA<p>Rust and Go only.'), DEFAULT_SEARCH, 0, ['typescript', 'react'])).toBeNull()
    expect(normalizeHnPost(post('Acme | Rust Engineer | Berlin | VISA<p>Rust and Go only.'), DEFAULT_SEARCH, 0, ['rust'])).not.toBeNull()
    expect(normalizeHnPost({ id: 2, text: 'Acme | Engineer | Berlin | VISA<p>React', created_at: '2020-01-01T00:00:00Z' }, DEFAULT_SEARCH, Date.now() - 86_400_000)).toBeNull()
  })
})

describe('Bundesagentur', () => {
  afterEach(() => _resetBundesagenturBlock())
  it('only spends detail calls on English engineering titles', () => {
    const rows = [
      { refnr: '1', titel: 'Senior Software Engineer (m/w/d)' },
      { refnr: '2', titel: 'Softwareentwickler Java (m/w/d)' },
      { refnr: '3', titel: 'Kaufmann im Einzelhandel' },
    ]
    expect(baCandidates(rows).map((r) => r.refnr)).toEqual(['1'])
  })
  it('normalizes a posting', () => {
    const j = normalizeBaPosting({ refnr: '10000-1-S', titel: 'Frontend Developer', arbeitgeber: 'Acme GmbH', arbeitsort: { ort: 'Berlin', land: 'Deutschland' }, aktuelleVeroeffentlichungsdatum: '2026-10-20' }, { stellenangebotsBeschreibung: '<p>React</p>' })
    expect(j).toMatchObject({ source: 'bundesagentur', externalId: '10000-1-S', company: 'Acme GmbH', countryCode: 'DE', description: 'React', url: 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1-S' })
  })
  it('treats HTTP 403 as a quiet skip and rests', async () => {
    let calls = 0
    const f = (async () => {
      calls++
      return new Response('forbidden', { status: 403 })
    }) as unknown as typeof fetch
    const ctx = ctxWith(f)
    const first = await bundesagenturAdapter.fetch({ query: 'react', countryCode: 'DE', maxDaysOld: 30, page: 1 }, ctx)
    const second = await bundesagenturAdapter.fetch({ query: 'node', countryCode: 'DE', maxDaysOld: 30, page: 1 }, ctx)
    expect(first.jobs).toEqual([])
    expect(second.requests).toBe(0)
    expect(calls).toBe(1)
  })
})

describe('employer link title match', () => {
  it('matches the same role written differently', () => {
    expect(sameTitle('Senior Software Engineer (m/w/d)', 'Senior Software Engineer')).toBe(true)
    expect(sameTitle('Senior Frontend Engineer - Payments', 'Senior Frontend Engineer, Payments')).toBe(true)
    expect(sameTitle('Senior Frontend Engineer', 'Senior Backend Engineer')).toBe(false)
  })
})
