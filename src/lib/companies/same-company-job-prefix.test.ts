import { describe, expect, it } from 'vitest'
import { sameCompanyKey } from './same-company'

describe('sameCompanyKey with a job-board prefix', () => {
  it('treats "Job  Tether Operations Limited" as Tether', () => {
    expect(sameCompanyKey('Job  Tether Operations Limited')).toBe(sameCompanyKey('Tether Operations Limited'))
  })
  it('keeps real company names that start with Job', () => {
    expect(sameCompanyKey('Job Squad')).toBe('jobsquad')
    expect(sameCompanyKey('Job Italia Spa')).toBe('jobitalia')
  })
})
