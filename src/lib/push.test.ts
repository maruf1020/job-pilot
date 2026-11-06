import { describe, expect, it } from 'vitest'
import { BURST_WINDOW_MS, markPushed, pushStyle, shouldPush } from './push'

const on = { pushEnabled: true, pushTypes: ['interview', 'reply', 'review_needed', 'error'] }

describe('phone push rules', () => {
  it('follows the switch and the chosen types', () => {
    expect(shouldPush('interview', on)).toBe(true)
    expect(shouldPush('sent', on)).toBe(false)
    expect(shouldPush('interview', { ...on, pushEnabled: false })).toBe(false)
  })
  it('sends replies every time but collapses bursty types to one per window', () => {
    const t = 1_000_000
    markPushed('reply', t)
    expect(shouldPush('reply', on, t + 1000)).toBe(true)
    markPushed('review_needed', t)
    expect(shouldPush('review_needed', on, t + 60_000)).toBe(false)
    expect(shouldPush('review_needed', on, t + BURST_WINDOW_MS)).toBe(true)
  })
  it('marks interviews and replies urgent', () => {
    expect(pushStyle('interview').priority).toBe('high')
    expect(pushStyle('run_complete').priority).toBe('low')
  })
})
