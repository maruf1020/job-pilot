import { describe, expect, it } from 'vitest'
import { freehireSearchUrl, normalizeFreehireJob } from './freehire'

const job = {
  public_slug: 'senior-frontend-engineer-acme-x1y2',
  source: 'greenhouse',
  url: 'https://job-boards.greenhouse.io/acme/jobs/123?utm_source=freehire.me',
  title: 'Senior Frontend Engineer',
  company: 'Acme',
  location: 'Dublin, Ireland',
  description: 'React and TypeScript.',
  skills: ['react', 'typescript'],
  work_mode: 'hybrid',
  countries: ['ie'],
  posted_at: '2026-10-20T00:00:00Z',
  enrichment: { seniority: 'senior', category: 'frontend', salary_min: 70000, salary_max: 90000, salary_currency: 'EUR', relocation: 'supported' },
  reality: { class: 'fresh', fake_freshness: false },
}

describe('freehire source', () => {
  it('asks for one country, the person skills and full descriptions', () => {
    const url = new URL(freehireSearchUrl({ query: '', countryCode: 'IE', maxDaysOld: 14, page: 3 }, ['TypeScript', 'Node.js', 'Figma']))
    expect(url.pathname).toBe('/api/v1/agent/jobs/search')
    expect(url.searchParams.get('countries')).toBe('ie')
    expect(url.searchParams.getAll('skills')).toEqual(['typescript', 'nodejs'])
    expect(url.searchParams.getAll('category')).toEqual(['frontend', 'fullstack', 'backend'])
    expect(url.searchParams.get('posted_within_days')).toBe('14')
    expect(url.searchParams.get('offset')).toBe('100')
  })

  it('keeps the employer link and reads relocation as a sponsorship signal', () => {
    const n = normalizeFreehireJob(job, 'IE')!
    expect(n).toMatchObject({ source: 'freehire', externalId: job.public_slug, countryCode: 'IE', salaryMin: 70000, currency: 'EUR', visaSponsorship: true })
    expect(n.url).toBe('https://job-boards.greenhouse.io/acme/jobs/123')
    expect(n.tags).toContain('relocation-supported')
  })

  it('drops standing ads and postings that only re-list another board', () => {
    expect(normalizeFreehireJob({ ...job, reality: { class: 'likely-evergreen' } })).toBeNull()
    expect(normalizeFreehireJob({ ...job, url: 'https://ie.whatjobs.com/pub_api__cpl__1' })).toBeNull()
    expect(normalizeFreehireJob({ ...job, location: 'Manila, Philippines' })).toBeNull()
    expect(normalizeFreehireJob({ ...job, url: 'https://ph.jobstreet.com/job/95335654' })).toBeNull()
  })

  it('passes an explicit "no visa sponsorship" through', () => {
    expect(normalizeFreehireJob({ ...job, enrichment: { visa_sponsorship: false } })?.visaSponsorship).toBe(false)
  })
})
