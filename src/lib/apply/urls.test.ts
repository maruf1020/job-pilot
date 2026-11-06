import { describe, expect, it } from 'vitest'
import { formTarget } from './urls'

const link = (externalId: string, url: string) => [{ source: 'ats', externalId, url }]

describe('direct application form links', () => {
  it('builds Greenhouse links even for jobs shown on company sites', () => {
    expect(formTarget({ url: 'https://stripe.com/jobs/listing/x/7302?gh_jid=7302', atsType: 'greenhouse' }, link('greenhouse:stripe:7302', 'https://stripe.com/jobs/listing/x/7302')).url).toBe(
      'https://job-boards.greenhouse.io/stripe/jobs/7302',
    )
    expect(formTarget({ url: 'https://job-boards.eu.greenhouse.io/celonis/jobs/77', atsType: 'greenhouse' }, link('greenhouse:celonis:77', 'https://job-boards.eu.greenhouse.io/celonis/jobs/77')).url).toBe(
      'https://job-boards.eu.greenhouse.io/celonis/jobs/77',
    )
  })
  it('opens the form page of Lever, Ashby and Workable directly', () => {
    expect(formTarget({ url: 'https://jobs.lever.co/kpler/0354b55d-7141-4491-98bc-538daeed8593', atsType: 'lever' }, link('lever:kpler:0354b55d-7141-4491-98bc-538daeed8593', '')).url).toBe(
      'https://jobs.lever.co/kpler/0354b55d-7141-4491-98bc-538daeed8593/apply',
    )
    expect(formTarget({ url: '', atsType: 'ashby' }, link('ashby:sierra:931cbf48-7e8a-485a-a45b-7e08adc62962', '')).url).toBe(
      'https://jobs.ashbyhq.com/sierra/931cbf48-7e8a-485a-a45b-7e08adc62962/application',
    )
    expect(formTarget({ url: 'https://apply.workable.com/j/81904DD41D', atsType: 'workable' }, link('workable:starling-bank:81904DD41D', 'https://apply.workable.com/j/81904DD41D')).url).toBe(
      'https://apply.workable.com/starling-bank/j/81904DD41D/apply/',
    )
  })
  it('goes to the apply step of Workday postings', () => {
    const url = 'https://salesforce.wd12.myworkdayjobs.com/External_Career_Site/job/Israel---Tel-Aviv/Forward-Deployed-Engineer_JR350080'
    const t = formTarget({ url, atsType: 'workday' }, link('workday:salesforce/External_Career_Site@wd12:JR350080', url))
    expect(t.url).toBe(`${url}/apply`)
    expect(t.site).toBe('workday')
  })
  it('falls back to the posting for other sites', () => {
    const t = formTarget({ url: 'https://www.adzuna.de/details/123', atsType: null }, [])
    expect(t).toEqual({ url: 'https://www.adzuna.de/details/123', ats: null, site: 'other' })
  })
  it('recognises ATS links found by other sources', () => {
    expect(formTarget({ url: 'https://boards.greenhouse.io/acme/jobs/123', atsType: null }, []).url).toBe('https://job-boards.greenhouse.io/acme/jobs/123')
  })
})
