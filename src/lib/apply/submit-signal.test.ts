import { describe, expect, it } from 'vitest'
import { classifyAnswer, describeSignal, isFormPost, rejectionDetail, submitEndpoint } from './submit-signal'

const PAGE = 'https://careers.anywhere.now/o/full-stack-developer-tendfor-1/c/new'

describe('submitEndpoint', () => {
  it("knows Recruitee's application post, also on a company's own careers domain", () => {
    expect(submitEndpoint('POST', 'https://careers.anywhere.now/candidates')).toBe('recruitee')
    expect(submitEndpoint('POST', 'https://powerprozesse.recruitee.com/l/de/candidates')).toBe('recruitee')
    expect(submitEndpoint('POST', 'https://x.recruitee.com/api/offers/full-stack-1/candidates')).toBe('recruitee')
  })

  it('ignores reads and other posts', () => {
    expect(submitEndpoint('GET', 'https://careers.anywhere.now/candidates')).toBeNull()
    expect(submitEndpoint('POST', 'https://careers.anywhere.now/candidates/123/files')).toBeNull()
    expect(submitEndpoint('POST', 'https://careers.anywhere.now/o/full-stack-developer-tendfor-1')).toBeNull()
  })
})

describe('isFormPost', () => {
  it('counts posts on the same site or an applicant system', () => {
    expect(isFormPost('POST', 'https://careers.anywhere.now/candidates', 'fetch', PAGE)).toBe(true)
    expect(isFormPost('POST', 'https://api.anywhere.now/apply', 'xhr', PAGE)).toBe(true)
    expect(isFormPost('POST', 'https://boards-api.greenhouse.io/v1/apply', 'fetch', 'https://acme.com/careers')).toBe(true)
  })

  it('leaves out analytics, error reports, CAPTCHA traffic, other sites and reads', () => {
    expect(isFormPost('POST', 'https://careers-analytics.recruitee.com/api/event', 'fetch', PAGE)).toBe(false)
    expect(isFormPost('POST', 'https://o451.ingest.de.sentry.io/api/1/envelope/', 'fetch', PAGE)).toBe(false)
    expect(isFormPost('POST', 'https://captcha-base.recruiteecdn.com/checksiteconfig', 'xhr', PAGE)).toBe(false)
    expect(isFormPost('POST', 'https://example.org/form', 'fetch', PAGE)).toBe(false)
    expect(isFormPost('GET', 'https://careers.anywhere.now/candidates', 'fetch', PAGE)).toBe(false)
    expect(isFormPost('POST', 'https://careers.anywhere.now/upload.png', 'image', PAGE)).toBe(false)
  })
})

describe('classifyAnswer', () => {
  it('reads the status the way the site does', () => {
    expect(classifyAnswer(201)).toBe('sent')
    expect(classifyAnswer(422)).toBe('rejected')
    expect(classifyAnswer(429, 'offer_limit')).toBe('already')
    expect(classifyAnswer(429)).toBe('already')
    expect(classifyAnswer(429, 'company_limit')).toBe('company_limit')
    expect(classifyAnswer(500)).toBeNull()
  })

  it('describes it in one line', () => {
    expect(describeSignal({ outcome: 'sent', status: 201, url: 'https://careers.anywhere.now/candidates', site: 'recruitee' })).toBe(
      'Recruitee accepted the application (HTTP 201 from /candidates)',
    )
  })
})

describe('rejectionDetail', () => {
  it('reads Recruitee field errors', () => {
    expect(rejectionDetail('{"errors":{"phone":["is invalid"],"cv":["can\'t be blank"]}}')).toBe("phone is invalid; cv can't be blank")
  })
  it('reads a plain error message', () => {
    expect(rejectionDetail('{"error":"captcha verification failed"}')).toBe('captcha verification failed')
  })
  it('falls back to the text of a non-JSON body', () => {
    expect(rejectionDetail('<html><body><h1>Unprocessable</h1></body></html>')).toBe('Unprocessable')
    expect(rejectionDetail('   ')).toBeNull()
  })
  it('is shown in the signal description', () => {
    expect(describeSignal({ outcome: 'rejected', status: 422, url: 'https://x.recruitee.com/l/en/candidates', site: 'recruitee', detail: 'phone is invalid' })).toBe('Recruitee rejected the form with errors (HTTP 422 from /l/en/candidates): phone is invalid')
  })
})
