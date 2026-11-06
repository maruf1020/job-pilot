import { db } from '@/lib/db'
import { autoSendRecipientProblem } from '@/lib/email/address'
import type { LeadItem } from '@/lib/email/needs-action'
import type { ProgressItem } from './opportunities'

/**
 * What only you can do, in one list (the highlighted box on Opportunities): answer the
 * companies that want something, finish forms the agents cannot (CAPTCHA, sign-in, emailed code, a question only
 * you can answer), approve emails to a person's address, answer open form questions, and settings you must change.
 */
export interface TodoItem {
  id: string
  /** urgent: a company is waiting on you; normal: it unblocks more applications. */
  priority: 'urgent' | 'normal'
  title: string
  detail: string | null
  href: string
  /** Opens outside the app (a link in a recruiter's email, RapidAPI). */
  external?: boolean
  count?: number
}

const LEAD_ACTION: Record<string, string> = {
  INTERVIEW_REQUEST: 'Reply to the interview request',
  NEEDS_INFO: 'Answer their question or do the test',
  POSITIVE: 'Reply to their interest',
  LOCATION_ISSUE: 'Read their location answer',
  APPLY_VIA_PORTAL: 'Apply on their site',
}

/** The reason a form waits for you, sorted into what you have to do there. */
export function formTaskKind(reason: string | null | undefined): 'captcha' | 'signin' | 'code' | 'question' | 'document' | 'other' {
  const r = reason ?? ''
  if (/captcha|turnstile|hcaptcha|recaptcha|robot|cloudflare/i.test(r)) return 'captcha'
  if (/verification code|emailed code|one-time|otp|code (we|was) sent|enter the code/i.test(r)) return 'code'
  if (/sign.?in|log.?in|password|account|already registered|register/i.test(r)) return 'signin'
  if (/document|reference|diploma|certificate|video link|portfolio file/i.test(r)) return 'document'
  if (/needs your answer|question|could not fill/i.test(r)) return 'question'
  return 'other'
}

const FORM_TASK: Record<ReturnType<typeof formTaskKind>, { title: string; detail: string }> = {
  captcha: { title: 'Solve the CAPTCHA and press Submit', detail: 'The form is filled; only the "I am human" check is left.' },
  signin: { title: 'Sign in (or create the account) and submit', detail: 'The site needs your own login. Once signed in, the app reuses it.' },
  code: { title: 'Enter the code the site emailed you', detail: 'Greenhouse and Oracle send a code to your Gmail after Submit.' },
  question: { title: 'Answer a question only you can answer', detail: 'Your answer is saved and reused on every later form.' },
  document: { title: 'Upload a document only you have', detail: 'A reference, diploma, video link or similar.' },
  other: { title: 'Finish these forms by hand', detail: 'The agents stopped on them; the reason is on each form.' },
}

export async function manualTodo(yourMove: LeadItem[], inProgress: ProgressItem[]): Promise<TodoItem[]> {
  const out: TodoItem[] = []

  // 1. Companies waiting on you: the most important, first.
  for (const l of yourMove) {
    out.push({
      id: `lead-${l.messageId}`,
      priority: l.classification === 'INTERVIEW_REQUEST' || l.classification === 'NEEDS_INFO' ? 'urgent' : 'normal',
      title: `${l.job.companyName}: ${LEAD_ACTION[l.classification] ?? 'Answer their email'}`,
      detail: l.suggestedNextAction ?? l.summary,
      href: `/applications/${l.applicationId}`,
    })
  }

  // 2. Hiring processes that went quiet for a week: a short, polite nudge from you.
  for (const p of inProgress.filter((x) => (x.quietDays ?? 0) >= 7)) {
    out.push({
      id: `quiet-${p.applicationId}`,
      priority: 'normal',
      title: `${p.company}: quiet for ${p.quietDays} days, send a short nudge`,
      detail: p.current ? `Step: ${p.current.name}` : null,
      href: `/applications/${p.applicationId}`,
    })
  }

  // 3. Forms the agents filled as far as they could.
  const waiting = await db.portalAttempt.findMany({
    where: { status: { in: ['NEEDS_HUMAN', 'AWAITING_REVIEW'] } },
    select: { applicationId: true, status: true, needsHumanReason: true, error: true },
  })
  const perApp = new Map<string, ReturnType<typeof formTaskKind>>()
  for (const w of waiting) perApp.set(w.applicationId, w.status === 'AWAITING_REVIEW' ? 'other' : formTaskKind(w.needsHumanReason ?? w.error))
  const byKind = new Map<ReturnType<typeof formTaskKind>, number>()
  for (const k of perApp.values()) byKind.set(k, (byKind.get(k) ?? 0) + 1)
  for (const kind of ['code', 'question', 'document', 'signin', 'captcha', 'other'] as const) {
    const n = byKind.get(kind)
    if (!n) continue
    out.push({ id: `forms-${kind}`, priority: kind === 'code' ? 'urgent' : 'normal', title: `${FORM_TASK[kind].title} (${n} form${n === 1 ? '' : 's'})`, detail: FORM_TASK[kind].detail, href: '/applications?view=ready', count: n })
  }

  // 4. Emails the app will not send by itself: the address is a person's or on another domain.
  const held = await db.application.findMany({
    where: { status: 'REVIEW', channel: 'email', toEmail: { not: null }, drafts: { some: { isSelected: true, passed: true } } },
    select: { toEmail: true, job: { select: { companyName: true, contactEmailSource: true, company: { select: { domain: true } } } } },
  })
  const suppressed = new Set((await db.suppressedAddress.findMany({ where: { email: { in: held.map((h) => h.toEmail!.toLowerCase()) } }, select: { email: true } })).map((s) => s.email))
  const toCheck = held.filter((h) => h.job.contactEmailSource !== 'guessed' && !suppressed.has(h.toEmail!.toLowerCase()) && autoSendRecipientProblem(h.toEmail!, { name: h.job.companyName, domain: h.job.company.domain }, h.job.contactEmailSource))
  if (toCheck.length) {
    out.push({ id: 'emails-check', priority: 'normal', title: `Check and approve ${toCheck.length} email${toCheck.length === 1 ? '' : 's'} to a person's address`, detail: 'Recruiter or founder addresses the app does not send to on its own.', href: '/applications?view=drafts', count: toCheck.length })
  }

  // 5. Form questions still without an answer.
  const open = await db.answerBank.count({ where: { answer: null } })
  if (open) out.push({ id: 'answers', priority: 'normal', title: `Answer ${open} saved form question${open === 1 ? '' : 's'}`, detail: 'Settings → Browser → Answers. Each answer is reused on every form.', href: '/settings/browser', count: open })

  // 6. A source that needs your own click.
  const jsearch = await db.searchRunLog.findFirst({ where: { message: { contains: 'not subscribed to this API' }, createdAt: { gte: new Date(Date.now() - 2 * 86_400_000) } }, select: { id: true } })
  if (jsearch) out.push({ id: 'jsearch', priority: 'normal', title: 'Subscribe to JSearch on RapidAPI (free plan)', detail: 'Google for Jobs results with direct employer links; skipped until the key is subscribed.', href: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/pricing', external: true })

  return out
}
