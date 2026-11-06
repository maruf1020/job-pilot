import { describe, expect, it } from 'vitest'
import { looksLikeJobLink } from './scrape'

describe('looksLikeJobLink', () => {
  const host = 'www.example.ie'
  it('accepts same-site links with job-like paths and real titles', () => {
    expect(looksLikeJobLink('https://www.example.ie/jobs/senior-software-engineer-123', 'Senior Software Engineer', host)).toBe(true)
    expect(looksLikeJobLink('https://careers.example.ie/vacancy/42', 'Frontend Developer (React)', host)).toBe(true)
  })
  it('rejects navigation, off-site and non-job links', () => {
    expect(looksLikeJobLink('https://www.example.ie/jobs', 'Next', host)).toBe(false)
    expect(looksLikeJobLink('https://other.com/jobs/1', 'Software Engineer', host)).toBe(false)
    expect(looksLikeJobLink('https://www.example.ie/about', 'About the company we are', host)).toBe(false)
    expect(looksLikeJobLink('https://www.example.ie/jobs/spec.pdf', 'Job specification doc', host)).toBe(false)
    expect(looksLikeJobLink('mailto:jobs@example.ie', 'jobs@example.ie', host)).toBe(false)
  })
})
