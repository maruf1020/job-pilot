import { describe, expect, it } from 'vitest'
import { collectCareersBoards, extractBoardRefs, extractCareerLinks, parseRobotsSitemaps, siteHost, sitemapCareerUrls } from './careers-discovery'

describe('extractBoardRefs', () => {
  it('finds links, iframes and scripts that name a board', () => {
    const html = `
      <a href="https://jobs.lever.co/acme-labs/abc-123">Open roles</a>
      <iframe src="https://boards.greenhouse.io/embed/job_board?for=acmegh"></iframe>
      <script src="//jobs.ashbyhq.com/acme-ash/embed"></script>
      <a href="https://acme.recruitee.com/o/dev">Dev</a>`
    const refs = extractBoardRefs(html)
    expect(refs).toContainEqual({ atsType: 'lever', slug: 'acme-labs' })
    expect(refs).toContainEqual({ atsType: 'greenhouse', slug: 'acmegh' })
    expect(refs).toContainEqual({ atsType: 'ashby', slug: 'acme-ash' })
    expect(refs).toContainEqual({ atsType: 'recruitee', slug: 'acme' })
  })
  it('reads JSON-escaped URLs and bare mentions', () => {
    const bs = String.fromCharCode(92)
    const html = `{"url":"https:${bs}/${bs}/jobs.smartrecruiters.com${bs}/AcmeCorp${bs}/12345"} data-board="teamtailor: acmett.teamtailor.com"`
    const refs = extractBoardRefs(html)
    expect(refs.map((r) => `${r.atsType}:${r.slug.toLowerCase()}`)).toEqual(expect.arrayContaining(['smartrecruiters:acmecorp', 'teamtailor:acmett']))
  })
  it('ignores the ATS own pages and unrelated links', () => {
    expect(extractBoardRefs('<a href="https://www.workable.com/pricing">x</a><a href="https://jobs.lever.co/">y</a> https://example.com/jobs')).toEqual([])
  })
  it('lists each board once', () => {
    const refs = extractBoardRefs('https://jobs.lever.co/acme/1 https://jobs.lever.co/acme/2 jobs.lever.co/acme')
    expect(refs.filter((r) => r.atsType === 'lever')).toHaveLength(1)
  })
})

describe('extractCareerLinks', () => {
  const html = `
    <a href="/blog/why-we-are-hiring-more">Blog</a>
    <a href="/careers">Careers</a>
    <a href="https://other.com/careers">Elsewhere</a>
    <a href="/about">About</a>
    <a href="/team"><span>Join us</span></a>`
  it('keeps same-site links that look like careers, short paths first', () => {
    const links = extractCareerLinks(html, 'https://www.acme.com/')
    expect(links[0]).toBe('https://www.acme.com/careers')
    expect(links).toContain('https://www.acme.com/team')
    expect(links.some((l) => l.includes('other.com'))).toBe(false)
    expect(links.some((l) => l.endsWith('/about'))).toBe(false)
  })
})

describe('robots and sitemaps', () => {
  it('reads Sitemap lines', () => {
    expect(parseRobotsSitemaps('User-agent: *\nDisallow: /x\nSitemap: https://acme.com/sitemap.xml\nsitemap: https://acme.com/s2.xml')).toEqual(['https://acme.com/sitemap.xml', 'https://acme.com/s2.xml'])
  })
  it('picks careers pages and child sitemaps', () => {
    const xml = `<urlset><url><loc>https://acme.com/</loc></url><url><loc>https://acme.com/company/careers</loc></url><url><loc>https://acme.com/blog/post-1</loc></url><url><loc>https://acme.com/page-sitemap.xml</loc></url></urlset>`
    const r = sitemapCareerUrls(xml)
    expect(r.pages).toEqual(['https://acme.com/company/careers'])
    expect(r.children).toEqual(['https://acme.com/page-sitemap.xml'])
  })
})

describe('siteHost', () => {
  it('cleans a domain or URL to a host', () => {
    expect(siteHost('https://www.Acme.com/path?x=1')).toBe('acme.com')
    expect(siteHost('acme.co.uk')).toBe('acme.co.uk')
    expect(siteHost('not a domain')).toBeNull()
    expect(siteHost('')).toBeNull()
  })
})

function page(map: Record<string, string>, calls: string[] = []): typeof fetch {
  return (async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    const body = map[url]
    return body === undefined ? new Response('nope', { status: 404 }) : new Response(body, { status: 200 })
  }) as unknown as typeof fetch
}

describe('collectCareersBoards', () => {
  it('finds a board named on the home page without more requests', async () => {
    const calls: string[] = []
    const refs = await collectCareersBoards('acme.com', page({ 'https://acme.com/': '<a href="https://jobs.lever.co/acme-x/1">jobs</a>' }, calls))
    expect(refs).toEqual([{ atsType: 'lever', slug: 'acme-x' }])
    expect(calls).toEqual(['https://acme.com/'])
  })
  it('follows the careers link and the usual paths', async () => {
    const refs = await collectCareersBoards(
      'acme.com',
      page({ 'https://acme.com/': '<a href="/work-with-us">Work with us</a>', 'https://acme.com/work-with-us': 'nothing', 'https://acme.com/careers': '<iframe src="https://boards.greenhouse.io/embed/job_board?for=acmegh"></iframe>' }),
    )
    expect(refs).toEqual([{ atsType: 'greenhouse', slug: 'acmegh' }])
  })
  it('tries www when the bare domain does not answer, and gives up when nothing does', async () => {
    const calls: string[] = []
    const none = await collectCareersBoards('gone.example', page({}, calls))
    expect(none).toEqual([])
    expect(calls).toEqual(['https://gone.example/', 'https://www.gone.example/'])
  })
  it('falls back to the sitemap and respects the request budget', async () => {
    const map = {
      'https://acme.com/': 'plain home',
      'https://acme.com/robots.txt': 'Sitemap: https://acme.com/sitemap.xml',
      'https://acme.com/sitemap.xml': '<urlset><url><loc>https://acme.com/open-vacancies</loc></url></urlset>',
      'https://acme.com/open-vacancies': 'https://acme.recruitee.com/o/dev',
    }
    const refs = await collectCareersBoards('acme.com', page(map), undefined, 20)
    expect(refs).toEqual([{ atsType: 'recruitee', slug: 'acme' }])
    const calls: string[] = []
    await collectCareersBoards('acme.com', page(map, calls), undefined, 3)
    expect(calls.length).toBeLessThanOrEqual(3)
  })
})
