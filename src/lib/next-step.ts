import type { ReplyClassification } from '@/lib/domain'

/**
 * "Next step" = an employer wants something from you (a call, an answer, a time slot). These
 * notifications are pinned in the bell and pop up until you open or dismiss them. Pure helpers,
 * shared by the server (notify, the API) and the client (bell, popup).
 */

export const NEXT_STEP_CLASSIFICATIONS = ['INTERVIEW_REQUEST', 'POSITIVE', 'NEEDS_INFO'] as const satisfies readonly ReplyClassification[]

/** Rejections, auto-replies, bounces, "apply on our site" and wrong-team replies ask nothing of you. */
export function isNextStep(classification: string | null | undefined): boolean {
  return (NEXT_STEP_CLASSIFICATIONS as readonly string[]).includes(classification ?? '')
}

/** A reply's classification decides; without one (a portal status check) only an interview counts. */
export function nextStepFor(type: string, classification?: string | null): boolean {
  return classification ? isNextStep(classification) : type === 'interview'
}

const LABEL: Record<(typeof NEXT_STEP_CLASSIFICATIONS)[number], string> = {
  INTERVIEW_REQUEST: 'Interview request',
  POSITIVE: 'Positive reply',
  NEEDS_INFO: 'They ask for information',
}

export function nextStepLabel(classification: string | null | undefined): string {
  return isNextStep(classification) ? LABEL[classification as keyof typeof LABEL] : 'Interview'
}

/** "Later" hides the items it saw until `until`. */
export interface NextStepSnooze {
  ids: string[]
  until: number
}

export const NEXT_STEP_SNOOZE_MS = 60 * 60_000

export function snoozeNextSteps(ids: string[], now = Date.now()): NextStepSnooze {
  return { ids, until: now + NEXT_STEP_SNOOZE_MS }
}

/**
 * What the popup lists: every next step you have not acknowledged, as soon as one of them is not
 * snoozed (a new interview email brings the popup back even during a "Later").
 */
export function popupItems<T extends { id: string; ackedAt?: string | Date | null }>(items: T[], snooze: NextStepSnooze | null, now = Date.now()): T[] {
  const pending = items.filter((n) => !n.ackedAt)
  const snoozed = snooze && now < snooze.until ? new Set(snooze.ids) : null
  return pending.some((n) => !snoozed?.has(n.id)) ? pending : []
}
