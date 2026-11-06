/**
 * Mail folders: which folder(s) an application belongs to. Pure (no DB), so it is unit tested.
 *
 * Reading folders are views over the same applications, so one can be in several: Sent, Important,
 * Needs answer, Replied. The pre-send folders are exclusive and checked in this order: Waiting (company
 * cooldown), Held (bounce guard, block list, guessed address, stack rule), then Drafts or Needs review.
 */

export const MAIL_FOLDERS = [
  'needs-answer',
  'important',
  'replied',
  'sent',
  'needs-review',
  'drafts',
  'waiting',
  'held',
] as const
export type MailFolder = (typeof MAIL_FOLDERS)[number]

export const FOLDER_META: Record<MailFolder, { label: string; description: string }> = {
  'needs-answer': {
    label: 'Needs answer',
    description: 'Replies nobody answered yet, most important first.',
  },
  important: {
    label: 'Important',
    description: 'Interviews and offers, positive replies, and companies that asked for a next step.',
  },
  replied: { label: 'Replied', description: 'Applications a company wrote back to.' },
  sent: { label: 'Sent', description: 'Applications sent by email, with the message that went out.' },
  'needs-review': {
    label: 'Needs review',
    description: 'Written and waiting for your yes: nothing blocks them except a check by you.',
  },
  drafts: { label: 'Drafts', description: 'Applications whose email is not written or not final yet.' },
  waiting: {
    label: 'Waiting',
    description: 'Same company applied to in the last 15 days. Each one shows the date it unlocks.',
  },
  held: {
    label: 'Held',
    description: 'Kept back on purpose: bounce guard, block list, guessed address or the stack rule.',
  },
}

/** Statuses from the moment an email left until the end of the road. */
export const SENT_STATUSES = ['SENT', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'NO_RESPONSE']
/** Latest replies that move an application one step ahead (same list as needs-action.ts NEXT_STEP). */
const IMPORTANT_REPLIES = ['INTERVIEW_REQUEST', 'POSITIVE', 'NEEDS_INFO']
const NOT_IMPORTANT_STATUS = ['REJECTED', 'SKIPPED']

export interface MailFacts {
  channel: string
  status: string
  notes: string | null
  /** How the recipient address was found (verified | company | posting | website | guessed ...). */
  contactEmailSource: string | null
  /** Classification of the latest real reply (not a bounce or an auto-reply), if any. */
  latestReply: string | null
  /** The inbox "needs your answer" rule says this application waits for you. */
  needsAnswer: boolean
}

export interface MailClass {
  folders: MailFolder[]
  /** ISO date (YYYY-MM-DD) the company cooldown ends; only for Waiting. */
  waitingUntil: string | null
  /** Why it is held; only for Held. */
  heldReason: string | null
}

/**
 * The cooldown marker in an application's notes: "Already sent an application to x on 2026-11-01; next one
 * possible from 2026-11-16" (also "Already applied ... next application possible from ..."), or "waiting until
 * 2026-11-16". Returns the unlock date, or null when the notes carry no such marker.
 */
export function parseWaitingUntil(notes: string | null | undefined): string | null {
  if (!notes) return null
  const m =
    /\balready (?:sent|applied)\b[\s\S]*?\bnext\b[\s\S]*?\bpossible from (\d{4}-\d{2}-\d{2})/i.exec(notes) ??
    /\bwaiting until (\d{4}-\d{2}-\d{2})/i.exec(notes)
  return m ? m[1] : null
}

/** The reason an application is held back on purpose, from its notes and address source; null when it is not held. */
export function heldReasonOf(
  notes: string | null | undefined,
  status: string,
  contactEmailSource: string | null,
): string | null {
  const n = notes ?? ''
  if (/block list|blocklist|suppress/i.test(n)) return 'Block list'
  if (/never applied to twice/i.test(n)) return 'Same job applied before'
  if (/bounce|brake|sending paused/i.test(n)) return 'Bounce guard'
  if (/\bguess/i.test(n)) return 'Guessed address'
  if (/\bstack\b|outside (?:of )?europe|not (?:in|within) europe/i.test(n)) return 'Stack rule'
  if (status === 'REVIEW' && contactEmailSource === 'guessed') return 'Guessed address'
  return null
}

export function classifyMail(f: MailFacts, now: Date = new Date()): MailClass {
  const folders: MailFolder[] = []
  const today = now.toISOString().slice(0, 10)
  let waitingUntil: string | null = null
  let heldReason: string | null = null

  if (f.needsAnswer) folders.push('needs-answer')
  if (
    f.status === 'INTERVIEW' ||
    f.status === 'OFFER' ||
    (f.latestReply && IMPORTANT_REPLIES.includes(f.latestReply) && !NOT_IMPORTANT_STATUS.includes(f.status))
  )
    folders.push('important')
  if (f.latestReply || ['REPLIED', 'INTERVIEW', 'OFFER'].includes(f.status)) folders.push('replied')
  if (f.channel === 'email' && SENT_STATUSES.includes(f.status)) folders.push('sent')

  if (f.channel === 'email' && (f.status === 'REVIEW' || f.status === 'DRAFT')) {
    const until = parseWaitingUntil(f.notes)
    // A date in the past means the company is open again: back to the normal review lists.
    if (until && until > today) {
      waitingUntil = until
      folders.push('waiting')
    } else {
      heldReason = heldReasonOf(f.notes, f.status, f.contactEmailSource)
      folders.push(heldReason ? 'held' : f.status === 'DRAFT' ? 'drafts' : 'needs-review')
    }
  }
  return { folders, waitingUntil, heldReason }
}
