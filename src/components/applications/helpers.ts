import { APP_STATUS_LABEL, fmtDateTime, type BadgeTone } from '@/lib/format'

/** Statuses at or beyond "the email went out". */
export const SENT_LIKE_STATUSES: readonly string[] = ['SENT', 'REPLIED', 'INTERVIEW', 'OFFER']

export function isSentLike(app: { status: string; sentAt: string | null }): boolean {
  return Boolean(app.sentAt) || SENT_LIKE_STATUSES.includes(app.status)
}

/** "Sent 12 Mar 2026, 09:10" / "Queued for …" / "—" */
export function whenLabel(app: { sentAt: string | null; scheduledFor: string | null }): string {
  if (app.sentAt) return `Sent ${fmtDateTime(app.sentAt)}`
  if (app.scheduledFor) return `Queued for ${fmtDateTime(app.scheduledFor)}`
  return '—'
}

export function channelLabel(channel: string): string {
  switch (channel) {
    case 'email':
      return 'Email'
    case 'ats':
      return 'ATS form'
    case 'portal':
      return 'Portal'
    default:
      return 'Unknown'
  }
}

export function statusLabel(status: string): string {
  const m = (APP_STATUS_LABEL as Record<string, { label: string } | undefined>)[status]
  return m?.label ?? status
}

export interface DetailNextStep {
  title: string
  description: string
  tone: BadgeTone
  /** In-page anchor of the block that does it. */
  anchor?: string
}

const NO_ANSWER = new Set(['AUTO_REPLY', 'BOUNCE', 'REJECTION'])

/** What to do now on the application page (the card at the top). Pure, UI only. */
export function nextStepFor(app: {
  status: string
  channel: string
  portalStatus?: string | null
  scheduledFor: string | null
  sentAt: string | null
  followUpDueAt: string | null
  followUpSentAt: string | null
  messages: Array<{ direction: string; classification: string | null; receivedAt: string | null; sentAt: string | null; createdAt: string; handledAt?: string | null }>
  /** The hiring steps saved on the application; the current one is the next action once nothing waits for a reply. */
  hiring?: { stages: Array<{ name: string; status: string; note?: string | null }> }
}): DetailNextStep {
  const at = (m: { receivedAt: string | null; sentAt: string | null; createdAt: string }) => new Date(m.receivedAt ?? m.sentAt ?? m.createdAt).getTime()
  const inbound = app.messages.filter((m) => m.direction === 'INBOUND' && !NO_ANSWER.has(m.classification ?? '')).sort((a, b) => at(b) - at(a))[0]
  const lastOut = Math.max(0, ...app.messages.filter((m) => m.direction === 'OUTBOUND').map(at))
  if (app.status === 'OFFER') return { title: 'Decide on the offer', description: 'Check the terms, the permit route and the start date before you answer.', tone: 'success', anchor: 'reply' }
  if (inbound && !inbound.handledAt && at(inbound) > lastOut) {
    if (inbound.classification === 'APPLY_VIA_PORTAL' || inbound.classification === 'WRONG_RECIPIENT') return { title: 'Apply on their website', description: 'They asked for the application through their own form. The browser agent can fill it for you.', tone: 'warning', anchor: 'browser-apply' }
    if (inbound.classification === 'INTERVIEW_REQUEST') return { title: 'Book the interview', description: 'They want to talk. Reply the same day with times that suit you.', tone: 'warning', anchor: 'reply' }
    return { title: 'Reply to them', description: 'Their message waits for your answer. Draft with AI, fill any placeholders, then send.', tone: 'warning', anchor: 'reply' }
  }
  if (app.portalStatus === 'AWAITING_REVIEW') return { title: 'Check the answers and submit', description: 'The agent filled the form and stopped before Submit.', tone: 'warning', anchor: 'browser-apply' }
  if (app.portalStatus === 'NEEDS_HUMAN') return { title: 'Finish the form', description: 'The agent stopped on something only you can do (a CAPTCHA, a sign-in or a question).', tone: 'warning', anchor: 'browser-apply' }
  if (app.portalStatus === 'QUEUED' || app.portalStatus === 'RUNNING') return { title: 'The agent is applying', description: 'A browser attempt is queued or running for this job.', tone: 'info', anchor: 'browser-apply' }
  // The saved hiring process knows the real next step ("Team reads everything and gets back").
  const currentStage = app.hiring?.stages.find((st) => st.status === 'current')
  if (currentStage && (app.status === 'INTERVIEW' || app.status === 'REPLIED')) return { title: currentStage.name, description: currentStage.note || 'The current step of their hiring process.', tone: 'info' }
  if (app.status === 'INTERVIEW') return { title: 'Prepare for the interview', description: 'Save the stages and your notes in the hiring process card.', tone: 'info' }
  if (['DRAFT', 'REVIEW', 'NEEDS_HUMAN'].includes(app.status)) return app.channel === 'email' ? { title: 'Review the draft', description: 'Read it, fix anything that is off, then approve or send it.', tone: 'warning', anchor: 'draft' } : { title: 'Apply on their website', description: 'Fill the form with the browser agent, or mark it applied when you did it yourself.', tone: 'warning', anchor: 'browser-apply' }
  if (app.status === 'QUEUED' || app.status === 'APPROVED') return { title: 'Queued to send', description: app.scheduledFor ? `Goes out ${fmtDateTime(app.scheduledFor)}, inside the send window.` : 'Goes out in the next send window.', tone: 'info' }
  if (app.followUpDueAt && !app.followUpSentAt && new Date(app.followUpDueAt).getTime() <= Date.now()) return { title: 'A follow-up is due', description: 'Approve it on the Applications page (Follow-ups due); it goes out in the same thread.', tone: 'info' }
  if (app.sentAt) return { title: 'Waiting for their answer', description: `Applied ${fmtDateTime(app.sentAt)}. Replies are checked every 30 minutes.`, tone: 'muted' }
  return { title: 'Nothing to do right now', description: 'This application is closed or skipped.', tone: 'muted' }
}

/** Tone for a judge `aiLikelihood` (0-100; the pipeline's pass mark is ≤ 30). */
export function aiTone(likelihood: number): BadgeTone {
  if (likelihood <= 30) return 'success'
  if (likelihood <= 60) return 'warning'
  return 'danger'
}
