import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/ai/usage', () => ({ getAiUsageSummary: vi.fn() }))
vi.mock('@/lib/settings/service', () => ({ getSettings: vi.fn() }))
vi.mock('@/lib/email/needs-action', () => ({ needsAction: vi.fn() }))

import { countPlaybook } from './gemini'

describe('countPlaybook', () => {
  const now = Date.parse('2026-10-30T12:00:00Z')
  const lines = [
    JSON.stringify({ at: '2026-10-29T10:00:00Z', kind: 'smartrecruiters', lesson: 'Pick the city from the list', outcome: 'submitted' }),
    JSON.stringify({ at: '2026-10-10T10:00:00Z', kind: 'workday', lesson: 'Save and Continue on each page', outcome: 'submitted' }),
    JSON.stringify({ at: '2026-10-30T09:00:00Z', kind: 'smartrecruiters', outcome: 'diagnosis', category: 'widget', fixHint: 'Click the option by its own ref' }),
    JSON.stringify({ at: '2026-10-30T09:30:00Z', kind: 'ashbyhq', outcome: 'diagnosis', category: 'captcha', fixHint: null }),
    'not json',
    '',
  ]

  it('counts lessons, fix hints, this week and kinds of site', () => {
    expect(countPlaybook(lines, now)).toEqual({ lessons: 2, lessons7d: 1, fixHints: 1, diagnoses7d: 2, siteKinds: 3 })
  })

  it('is empty without a playbook', () => {
    expect(countPlaybook([], now)).toEqual({ lessons: 0, lessons7d: 0, fixHints: 0, diagnoses7d: 0, siteKinds: 0 })
  })
})
