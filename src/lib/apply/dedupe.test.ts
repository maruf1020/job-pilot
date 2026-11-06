import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { companyKey, postingKey } from './portal-batch'

describe('one job, two records', () => {
  it('reads one company under its ATS domain and legal form', () => {
    expect(companyKey('instabee.teamtailor.com')).toBe(companyKey('Instabee'))
    expect(companyKey('Instabee AB')).toBe('instabee')
    expect(companyKey('Datawords GmbH')).toBe('datawords')
    expect(companyKey('tieto2')).toBe('tieto2')
    expect(companyKey('Autodesk')).not.toBe(companyKey('Adtran'))
  })

  it('reads one posting from two addresses', () => {
    expect(postingKey('https://career.instabee.com/jobs/8441989-senior-backend?utm=x')).toBe(postingKey('https://career.instabee.com/jobs/8441989-senior-backend/'))
    expect(postingKey('https://www.linkedin.com/jobs/view/4480000406/?trackingId=a')).toBe('linkedin.com/jobs/view/4480000406')
    // A careers home page names no single job.
    expect(postingKey('https://careers.example.com/jobs')).toBeNull()
    expect(postingKey(null)).toBeNull()
  })
})
