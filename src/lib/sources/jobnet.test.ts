import { describe, expect, it } from 'vitest'
import { cleanApplyUrl, jobnetSearchUrl, looksDanish, normalizeJobnetAd, withJobnetDetail } from './jobnet'

const ad = {
  jobAdId: '20b05c2d-823e-4271-8e52-2f4007b2bfc6',
  title: 'Frontend developer ',
  hiringOrgName: 'Cadpeople',
  occupation: 'Softwareudvikler, frontend',
  municipality: 'Aarhus',
  postalDistrictName: 'Aarhus C',
  country: 'Danmark',
  description:
    '<p><strong>Great code is only half the job</strong></p><p>Cadpeople is hiring a frontend developer in Aarhus who writes solid code with React and TypeScript, understands the client and makes it feel right. Questions? Write to jobs@cadpeople.dk.</p>',
  publicationDate: '2026-10-26T00:00:00+01:00',
  applicationDeadline: '2027-01-26T00:00:00+01:00',
  workHourPartTime: false,
  isExternal: true,
  jobAdUrl: 'https://app.elvium.com/en/positions/36744/job_posting',
}

const danish = {
  ...ad,
  jobAdId: 'aba66a50-ea91-4cef-8fe8-278cf7f96419',
  title: 'Full Stack Udvikler til Koncern IT i Udlændingestyrelsen',
  description: '<p>Vil du udvikle løsninger, der understøtter nogle af de centrale digitale processer på udlændingeområdet? Har du praktisk erfaring med softwareudvikling, og vil du arbejde med os?</p>',
}

describe('jobnet source', () => {
  it('searches one keyword at a time, newest first, 50 a page', () => {
    const url = new URL(jobnetSearchUrl('node.js', 2))
    expect(url.origin + url.pathname).toBe('https://jobnet.dk/bff/FindJob/Search')
    expect(url.searchParams.get('searchString')).toBe('node.js')
    expect(url.searchParams.get('resultsPerPage')).toBe('50')
    expect(url.searchParams.get('pageNumber')).toBe('2')
    expect(url.searchParams.get('orderType')).toBe('PublicationDate')
  })

  it('keeps the employer link of an external ad and the plain-text description', () => {
    const n = normalizeJobnetAd(ad)!
    expect(n).toMatchObject({ source: 'jobnet', externalId: ad.jobAdId, title: 'Frontend developer', company: 'Cadpeople', location: 'Aarhus C, Denmark', countryCode: 'DK', contactEmail: 'jobs@cadpeople.dk' })
    expect(n.url).toBe('https://app.elvium.com/en/positions/36744/job_posting')
    expect(n.description).toContain('Great code is only half the job')
    expect(n.description).not.toContain('<p>')
    expect(n.postedAt?.toISOString()).toBe('2026-10-25T23:00:00.000Z')
    expect(n.raw).toMatchObject({ posting: `https://jobnet.dk/find-job/${ad.jobAdId}`, deadline: '2027-01-26' })
  })

  it('cuts slugged LinkedIn links to the job id', () => {
    const n = normalizeJobnetAd({ ...ad, jobAdUrl: 'https://dk.linkedin.com/jobs/view/senior-frontend-engineer-at-dfds-4475511283?refId=abc' })!
    expect(n.url).toBe('https://www.linkedin.com/jobs/view/4475511283/')
    expect(cleanApplyUrl('javascript:alert(1)')).toBeNull()
    expect(cleanApplyUrl('not a url')).toBeNull()
  })

  it('links an ad posted on Jobnet itself to Jobnet until its detail gives the application link', () => {
    const internal = normalizeJobnetAd({ ...ad, isExternal: false, jobAdUrl: '' })!
    expect(internal.url).toBe(`https://jobnet.dk/find-job/${ad.jobAdId}`)
    const done = withJobnetDetail(internal, {
      job: { classifications: ['EURES', 'WorkInDenmark'] },
      application: { url: 'https://nordicrcc.easycruit.com/vacancy/3668999/243885?iso=gb', contactPersons: [{ emailAddress: ' PYH@nordic-rcc.net ' }] },
    })
    expect(done.url).toBe('https://nordicrcc.easycruit.com/vacancy/3668999/243885?iso=gb')
    expect(done.contactEmail).toBe('pyh@nordic-rcc.net')
    expect(done.tags).toContain('work-in-denmark')
    expect(withJobnetDetail(internal, null)).toBe(internal)
  })

  it('drops Danish postings, non-engineering titles and jobs abroad', () => {
    expect(normalizeJobnetAd(danish)).toBeNull()
    expect(normalizeJobnetAd({ ...ad, title: 'AV Teknikker til Roskilde Universitet' })).toBeNull()
    expect(normalizeJobnetAd({ ...ad, country: 'Tyskland' })).toBeNull()
  })

  it('tells Danish text from English', () => {
    expect(looksDanish('Vil du være én af vores nye fullstack udviklere bag fundamentet til Danmarks digitale cyberforsvar?')).toBe(true)
    expect(looksDanish('Senior Developer til Nordic RCC. Are you an experienced software developer with a passion for building high-quality applications?')).toBe(false)
    expect(looksDanish('Frontend Developer')).toBe(false)
  })
})
