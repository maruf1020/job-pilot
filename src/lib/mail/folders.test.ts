import { describe, expect, it } from 'vitest'
import { classifyMail, heldReasonOf, parseWaitingUntil, type MailFacts } from './folders'

const NOW = new Date('2026-11-05T12:00:00Z')
const base: MailFacts = {
  channel: 'email',
  status: 'REVIEW',
  notes: null,
  contactEmailSource: 'company',
  latestReply: null,
  needsAnswer: false,
}
const folders = (f: Partial<MailFacts>) => classifyMail({ ...base, ...f }, NOW).folders

describe('parseWaitingUntil', () => {
  it('reads the unlock date of a company cooldown note', () => {
    expect(
      parseWaitingUntil(
        'Already applied to Acme in DE ("Dev") on 2026-11-01; next application possible from 2026-11-16',
      ),
    ).toBe('2026-11-16')
    expect(
      parseWaitingUntil(
        'Already sent an application to hr@acme.com ("Dev") on 2026-11-01; next one possible from 2026-11-16',
      ),
    ).toBe('2026-11-16')
    expect(
      parseWaitingUntil(
        'Auto-apply held this one: Already applied to Acme on 2026-11-01; next application possible from 2026-11-16',
      ),
    ).toBe('2026-11-16')
    expect(parseWaitingUntil('Waiting until 2026-11-16')).toBe('2026-11-16')
  })
  it('ignores notes without the marker', () => {
    expect(parseWaitingUntil(null)).toBeNull()
    expect(parseWaitingUntil('Draft did not pass the humanizer')).toBeNull()
    expect(
      parseWaitingUntil('Another application to Acme is already waiting to be sent; only one per 15 days'),
    ).toBeNull()
  })
})

describe('heldReasonOf', () => {
  it('names the guard', () => {
    expect(heldReasonOf('"a@b.c" is on the block list since 2026-10-01 (bounced)', 'REVIEW', null)).toBe(
      'Block list',
    )
    expect(heldReasonOf('Automatic sending paused: 9 of 60 emails bounced', 'REVIEW', null)).toBe(
      'Bounce guard',
    )
    expect(heldReasonOf('Recipient address is a guess (allow guessed addresses)', 'REVIEW', null)).toBe(
      'Guessed address',
    )
    expect(heldReasonOf('Outside Europe', 'REVIEW', null)).toBe('Stack rule')
    expect(heldReasonOf('Stack does not match', 'REVIEW', null)).toBe('Stack rule')
  })
  it('treats a guessed address without a note as held, but only in review', () => {
    expect(heldReasonOf(null, 'REVIEW', 'guessed')).toBe('Guessed address')
    expect(heldReasonOf(null, 'DRAFT', 'guessed')).toBeNull()
    expect(heldReasonOf('Draft did not pass the humanizer', 'REVIEW', 'company')).toBeNull()
  })
})

describe('classifyMail', () => {
  it('puts a sent application in Sent, any later status too', () => {
    for (const status of ['SENT', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'NO_RESPONSE'])
      expect(folders({ status })).toContain('sent')
    expect(folders({ status: 'QUEUED' })).not.toContain('sent')
    expect(folders({ status: 'SENT', channel: 'portal' })).not.toContain('sent')
  })
  it('flags interviews, offers and next-step replies as important', () => {
    expect(folders({ status: 'INTERVIEW' })).toContain('important')
    expect(folders({ status: 'OFFER' })).toContain('important')
    expect(folders({ status: 'REPLIED', latestReply: 'POSITIVE' })).toContain('important')
    expect(folders({ status: 'REPLIED', latestReply: 'INTERVIEW_REQUEST' })).toContain('important')
    expect(folders({ status: 'REPLIED', latestReply: 'NEEDS_INFO' })).toContain('important')
    expect(folders({ status: 'REPLIED', latestReply: 'REJECTION' })).not.toContain('important')
    expect(folders({ status: 'REJECTED', latestReply: 'POSITIVE' })).not.toContain('important')
  })
  it('lists replied and needs-answer applications', () => {
    expect(folders({ status: 'REPLIED' })).toEqual(['replied', 'sent'])
    expect(folders({ status: 'SENT', latestReply: 'OTHER', needsAnswer: true })).toEqual([
      'needs-answer',
      'replied',
      'sent',
    ])
    expect(folders({ status: 'SENT' })).toEqual(['sent'])
  })
  it('separates drafts from needs review', () => {
    expect(folders({ status: 'DRAFT' })).toEqual(['drafts'])
    expect(folders({ status: 'REVIEW' })).toEqual(['needs-review'])
    expect(folders({ status: 'REVIEW', notes: 'Draft did not pass the humanizer' })).toEqual(['needs-review'])
  })
  it('puts a cooldown in Waiting with its date, for review and draft alike', () => {
    const notes = 'Already applied to Acme ("Dev") on 2026-11-01; next application possible from 2026-11-16'
    for (const status of ['REVIEW', 'DRAFT']) {
      const c = classifyMail({ ...base, status, notes }, NOW)
      expect(c.folders).toEqual(['waiting'])
      expect(c.waitingUntil).toBe('2026-11-16')
    }
  })
  it('sends an expired cooldown back to the normal lists', () => {
    const notes = 'Already applied to Acme ("Dev") on 2026-10-01; next application possible from 2026-10-16'
    const c = classifyMail({ ...base, status: 'REVIEW', notes }, NOW)
    expect(c.folders).toEqual(['needs-review'])
    expect(c.waitingUntil).toBeNull()
  })
  it('holds guarded applications with the reason', () => {
    const c = classifyMail({ ...base, status: 'REVIEW', contactEmailSource: 'guessed' }, NOW)
    expect(c.folders).toEqual(['held'])
    expect(c.heldReason).toBe('Guessed address')
    expect(
      classifyMail(
        { ...base, status: 'DRAFT', notes: '"x@y.z" is on the block list since 2026-10-01 (bounce)' },
        NOW,
      ).folders,
    ).toEqual(['held'])
  })
  it('keeps waiting ahead of held when both apply', () => {
    const notes =
      'Already sent an application to hr@acme.com on 2026-11-01; next one possible from 2026-11-16 (bounce guard)'
    expect(folders({ status: 'REVIEW', notes })).toEqual(['waiting'])
  })
  it('ignores non-email applications for the pre-send folders', () => {
    expect(folders({ status: 'REVIEW', channel: 'ats' })).toEqual([])
  })
})
