import { describe, expect, it } from 'vitest'
import { REPLY_CLASSIFICATIONS } from './domain'
import { NEXT_STEP_SNOOZE_MS, isNextStep, nextStepFor, nextStepLabel, popupItems, snoozeNextSteps } from './next-step'

describe('next step rules', () => {
  it('counts interview requests, positive replies and questions only', () => {
    const yes = REPLY_CLASSIFICATIONS.filter(isNextStep)
    expect(yes).toEqual(['INTERVIEW_REQUEST', 'POSITIVE', 'NEEDS_INFO'])
    expect(isNextStep(null)).toBe(false)
    expect(isNextStep(undefined)).toBe(false)
  })
  it('lets the classification decide, and an interview count without one', () => {
    expect(nextStepFor('reply', 'POSITIVE')).toBe(true)
    expect(nextStepFor('reply', 'REJECTION')).toBe(false)
    expect(nextStepFor('interview', 'BOUNCE')).toBe(false)
    expect(nextStepFor('interview')).toBe(true)
    expect(nextStepFor('reply')).toBe(false)
    expect(nextStepFor('sent', null)).toBe(false)
  })
  it('labels each kind', () => {
    expect(nextStepLabel('NEEDS_INFO')).toBe('They ask for information')
    expect(nextStepLabel(null)).toBe('Interview')
  })
})

describe('next step popup', () => {
  const a = { id: 'a', ackedAt: null }
  const b = { id: 'b', ackedAt: null }
  const done = { id: 'c', ackedAt: '2026-10-26T10:00:00Z' }
  const now = 1_000_000

  it('lists every unacknowledged item and never an acknowledged one', () => {
    expect(popupItems([a, done, b], null, now)).toEqual([a, b])
    expect(popupItems([done], null, now)).toEqual([])
  })
  it('stays closed while "Later" covers everything, and comes back when it runs out', () => {
    const snooze = { ids: ['a', 'b'], until: now + 60_000 }
    expect(popupItems([a, b], snooze, now)).toEqual([])
    expect(popupItems([a, b], snooze, now + 60_000)).toEqual([a, b])
  })
  it('opens again for a new item during "Later", listing the snoozed ones too', () => {
    const snooze = { ids: ['a'], until: now + 60_000 }
    expect(popupItems([b, a], snooze, now)).toEqual([b, a])
  })
  it('snoozes for an hour', () => {
    const snooze = snoozeNextSteps(['a', 'b'], now)
    expect(popupItems([a, b], snooze, now + NEXT_STEP_SNOOZE_MS - 1)).toEqual([])
    expect(popupItems([a, b], snooze, now + NEXT_STEP_SNOOZE_MS)).toEqual([a, b])
  })
})
