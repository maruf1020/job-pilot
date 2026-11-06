import { describe, expect, it } from 'vitest'
import { parsePortalStatus } from './status-check'
import { generatePassword, workdayStatusUrl } from './workday'

describe('candidate portal status', () => {
  const page = `My Applications  Active  Senior Software Engineer  JR350080  Submitted 10/23/2026  Under Consideration
    Backend Engineer  JR3111  Submitted 09/30/2026  No Longer Under Consideration  Frontend Engineer  Withdrawn`
  it('reads the status next to each job title', () => {
    expect(parsePortalStatus(page, 'Senior Software Engineer')?.status).toBe('IN_REVIEW')
    expect(parsePortalStatus(page, 'Backend Engineer')?.status).toBe('REJECTED')
    expect(parsePortalStatus(page, 'Frontend Engineer')?.status).toBe('WITHDRAWN')
    expect(parsePortalStatus(page, 'Data Engineer')).toBeNull()
  })
})

describe('workday helpers', () => {
  it('finds the candidate home of a tenant', () => {
    expect(workdayStatusUrl('https://salesforce.wd12.myworkdayjobs.com/External_Career_Site/job/Israel---Tel-Aviv/Forward-Deployed-Engineer_JR350080/apply')).toBe(
      'https://salesforce.wd12.myworkdayjobs.com/External_Career_Site/userHome',
    )
    expect(workdayStatusUrl('https://mastercard.wd1.myworkdayjobs.com/en-US/CorporateCareers/job/Dublin/X_R-1')).toBe('https://mastercard.wd1.myworkdayjobs.com/CorporateCareers/userHome')
  })
  it('generates strong passwords', () => {
    for (let i = 0; i < 20; i++) {
      const p = generatePassword()
      expect(p).toHaveLength(16)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[0-9]/)
      expect(p).toMatch(/[^A-Za-z0-9]/)
    }
  })
})
