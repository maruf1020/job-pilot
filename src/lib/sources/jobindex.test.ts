import { describe, expect, it } from 'vitest'
import { jobindexSearchUrl, normalizeJobindexResult, parseJobindexPage } from './jobindex'

const card = (href: string, teaser: string) =>
  `<div id="jobad-wrapper-h1709991"><div class="PaidJob"><div class="jix-toolbar-top__company"><a href="https://xci.dk/">XCI A/S</a></div><div class="PaidJob-inner"><h4><A HREF="${href}" data-click="/c?t=h1709991&amp;ctx=w&amp;jsp=4" rel="noopener">Frontend Software Developer</a></h4><div class="jobad-element-area"><span class="jix_robotjob--area">Aalborg</span></div><p>${teaser}</p></div><time datetime="2026-10-23">23-10-2026</time></div></div>`

const result = {
  tid: 'h1709991',
  headline: 'Frontend Software Developer',
  companytext: 'XCI A/S',
  company: { name: 'XCI A/S' },
  area: 'Aalborg og mulighed for hjemmearbejde',
  firstdate: '2026-10-23',
  lastdate: '2026-11-20',
  app_apply_url: null as string | null,
  html: card(
    'https://xci.teamtailor.com/jobs/8606683-frontend-software-developer?promotion=2261296-jobindex',
    'If you find motivation in working in a dynamic, innovative environment, and have experience with JavaScript, building UI and data processing, we would love to have you as our next team member.',
  ),
  home_workplace: false,
  is_archived: false,
  source: null,
}

describe('jobindex source', () => {
  it('searches one keyword newest first, with the closest posting age the form offers', () => {
    const url = new URL(jobindexSearchUrl('typescript', 3, 10))
    expect(url.origin + url.pathname).toBe('https://www.jobindex.dk/jobsoegning')
    expect(url.searchParams.get('q')).toBe('typescript')
    expect(url.searchParams.get('sort')).toBe('date')
    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('jobage')).toBe('14')
    expect(new URL(jobindexSearchUrl('react', 1, 45)).searchParams.has('jobage')).toBe(false)
  })

  it('reads the results from the JSON embedded in the search page', () => {
    const stash = { common: { note: 'braces } and "quotes" in strings' }, 'jobsearch/result_app/list': { storeData: { searchResponse: { hitcount: 26, total_pages: 2, max_page: 50, results: [result] } } } }
    const html = `<html><script>var Stash = ${JSON.stringify(stash)};\nvar Other = {};</script></html>`
    const sr = parseJobindexPage(html)!
    expect(sr.hitcount).toBe(26)
    expect(sr.results[0].tid).toBe('h1709991')
    expect(parseJobindexPage('<html>no data</html>')).toBeNull()
  })

  it('links to the posting the card names and keeps the teaser as the description', () => {
    const n = normalizeJobindexResult(result)!
    expect(n).toMatchObject({ source: 'jobindex', externalId: 'h1709991', company: 'XCI A/S', location: 'Aalborg, Denmark', countryCode: 'DK', remote: false })
    expect(n.url).toBe('https://xci.teamtailor.com/jobs/8606683-frontend-software-developer?promotion=2261296-jobindex')
    expect(n.description).toMatch(/^If you find motivation/)
    expect(n.tags).toContain('hybrid')
    expect(n.postedAt?.toISOString()).toBe('2026-10-23T00:00:00.000Z')
    expect(n.raw).toMatchObject({ posting: 'https://www.jobindex.dk/vis-job/h1709991', deadline: '2026-11-20' })
  })

  it("prefers the employer's application form, without Jobindex's markers", () => {
    const form = 'https://candidate.hr-manager.net/ApplicationForm/SinglePageApplicationForm.aspx?cid=3010&ProjectId=171681&apply_with=jobdk&MediaId=5166'
    expect(normalizeJobindexResult({ ...result, app_apply_url: form })!.url).toBe('https://candidate.hr-manager.net/ApplicationForm/SinglePageApplicationForm.aspx?cid=3010&ProjectId=171681&MediaId=5166')
    expect(normalizeJobindexResult({ ...result, app_apply_url: 'https://nti.career.emply.com/apply/plm/ywjn99/en#jobdk' })!.url).toBe('https://nti.career.emply.com/apply/plm/ywjn99/en')
    expect(normalizeJobindexResult({ ...result, app_apply_url: 'https://x.example/apply?apply_with=jobdk' })!.url).toBe('https://x.example/apply')
  })

  it('falls back to the Jobindex posting when the card has no usable link', () => {
    const n = normalizeJobindexResult({ ...result, html: card('/c?t=h1709991&amp;ctx=w', 'We are hiring a React developer for our product team in Aalborg.') })!
    expect(n.url).toBe('https://www.jobindex.dk/vis-job/h1709991')
  })

  it('drops Danish postings, other roles and archived ads', () => {
    const danish = { ...result, headline: 'Integration Developer til Maki A/S', html: card('https://www.jobindex.dk/jobannonce/h1710579', 'Vil du arbejde med Azure og automation? og udvikle integrationer, der gør en forskel i hverdagen?') }
    expect(normalizeJobindexResult(danish)).toBeNull()
    expect(normalizeJobindexResult({ ...result, headline: 'Smed til fast weekendarbejde omkring Billund' })).toBeNull()
    expect(normalizeJobindexResult({ ...result, is_archived: true })).toBeNull()
  })
})
