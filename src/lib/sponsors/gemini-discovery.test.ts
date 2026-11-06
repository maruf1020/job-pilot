import { describe, expect, it } from 'vitest'
import { boardsInText } from './gemini-discovery'

describe('boards named in Gemini search answers', () => {
  it('turns posting links into unique company boards', () => {
    const text = [
      'https://jobs.lever.co/acme/1234-abcd',
      'https://jobs.lever.co/acme/9999-other',
      'https://job-boards.greenhouse.io/examplehq/jobs/4567890',
      'Some prose with https://example.com/careers that is not an ATS.',
    ].join('\n')
    const boards = boardsInText(text).map((b) => `${b.atsType}:${b.slug}`)
    expect(boards).toContain('lever:acme')
    expect(boards).toContain('greenhouse:examplehq')
    expect(boards.filter((b) => b === 'lever:acme')).toHaveLength(1)
    expect(boards.some((b) => b.includes('example.com'))).toBe(false)
  })
})
