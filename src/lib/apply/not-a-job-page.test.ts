import { describe, expect, it } from 'vitest'
import { notAJobPage } from './urls'

describe('notAJobPage', () => {
  it.each([
    'https://www.linkedin.com/feed/update/urn:li:activity:7513367057107886081/',
    'https://www.linkedin.com/company/archer-recruitment/',
    'https://www.linkedin.com/in/someone/',
    'https://news.ycombinator.com/item?id=41425910',
    'https://apply.ycombinator.com/apps/123/edit',
    'https://jobicy.com/my-profile',
    'https://quill.co/',
    'https://ledgebrook.com/careers',
    'https://neoshare.de/',
  ])('flags %s', (url) => {
    expect(notAJobPage(url)).not.toBeNull()
  })

  it.each([
    'https://careers.nebius.com/?gh_jid=1',
    'https://www.ycombinator.com/companies/x/jobs/y',
    'https://www.linkedin.com/jobs/view/4486429935/',
    'https://jobs.lever.co/source.ai/1fa9ddfd-be43-4c1a-8f9d-76b1f12b0456/apply',
    'https://tether.recruitee.com/o/frontend-desktop-engineer-nigeria/c/new',
    'https://www.adzuna.de/details/5123456789',
    'https://example.com/careers/senior-frontend-engineer',
  ])('keeps %s', (url) => {
    expect(notAJobPage(url)).toBeNull()
  })

  it('flags "who wants to be hired" posts by their company name', () => {
    expect(notAJobPage('https://example.com/careers/x', 'Location: Berlin')).not.toBeNull()
  })
})
