import type { Page } from 'playwright'
import { openInCleanChrome } from '@/lib/browser/clean-chrome'
import { db } from '@/lib/db'
import { learnFromYou } from './answer-bank'
import { markSubmittedByHand } from './service'

/**
 * What the person can tell the panel on a form besides filling it ("close this tab" once only
 * got "I cannot close your browser tab"): close the tab, leave it for later with a note, skip the job,
 * record that the person sent it themselves, keep an answer for every form, or note something on this application.
 * The panel's quick buttons send the slash forms; free text is mapped to the same commands by the chat.
 */
export const PANEL_COMMANDS = ['none', 'close_tab', 'later', 'skip_job', 'mark_submitted', 'save_answer', 'note', 'open_clean'] as const
export type PanelCommand = (typeof PANEL_COMMANDS)[number]

export interface CommandArgs {
  /** For later / note: what to remember about this application. */
  note?: string
  /** For save_answer: the form question and the user's answer, kept in the answer bank for all forms. */
  question?: string
  answer?: string
}

/** The quick buttons' messages ("/close", "/later: record the video") and their plain-word forms. */
export function quickCommand(text: string): { command: PanelCommand; args: CommandArgs } | null {
  const t = text.trim()
  const slash = /^\/(close|later|skip|submitted|note|clean)\b:?\s*([\s\S]*)$/i.exec(t)
  if (slash) {
    const rest = slash[2].trim()
    const command = ({ close: 'close_tab', later: 'later', skip: 'skip_job', submitted: 'mark_submitted', note: 'note', clean: 'open_clean' } as const)[slash[1].toLowerCase() as 'close' | 'later' | 'skip' | 'submitted' | 'note' | 'clean']
    return { command, args: rest ? { note: rest } : {} }
  }
  // "open a new separate chrome", "open it in clean chrome"
  if (/\b(separate|clean|new|normal|another|other|fresh)\s+(chrome|browser|window)\b/i.test(t) && /\b(open|use|try|move)\b/i.test(t)) return { command: 'open_clean', args: {} }
  // Short, unmistakable orders need no AI call ("close this tab now", "close tab").
  if (/^(please\s+)?close( (this|the))?( tab| page)?( now)?( please)?[.!]*$/i.test(t)) return { command: 'close_tab', args: {} }
  return null
}

const closeSoon = (page: Page) => {
  // Long enough for the reply to show in the panel first.
  setTimeout(() => void page.close().catch(() => undefined), 1800)
}

async function addNote(applicationId: string, text: string) {
  const app = await db.application.findUnique({ where: { id: applicationId }, select: { notes: true } })
  const line = `${new Date().toISOString().slice(0, 10)}: ${text}`
  await db.application.update({ where: { id: applicationId }, data: { notes: app?.notes ? `${app.notes}\n${line}` : line, lastActivityAt: new Date() } })
  await db.applicationEvent.create({ data: { applicationId, type: 'note', message: text.slice(0, 500) } })
}

/** Carry out one panel command for this application and say in one line what happened. */
export async function runPanelCommand(page: Page, applicationId: string, command: PanelCommand, args: CommandArgs, log: (m: string) => void): Promise<string> {
  const app = await db.application.findUnique({ where: { id: applicationId }, select: { id: true, jobId: true, job: { select: { companyName: true, title: true } } } })
  if (!app) return 'This application is gone.'
  log(`panel command ${command}${args.note ? ` (${args.note.slice(0, 80)})` : ''}`)
  switch (command) {
    case 'close_tab':
      closeSoon(page)
      return 'Closing this tab now. The application stays in Needs you, so you can open it again any time.'
    case 'later': {
      const note = args.note?.trim() || 'To finish this form later.'
      await addNote(applicationId, `To do before applying: ${note}`)
      closeSoon(page)
      return `Saved on the application: "${note}". Closing this tab; it stays in Needs you for when you are ready.`
    }
    case 'skip_job': {
      await db.application.update({ where: { id: applicationId }, data: { status: 'SKIPPED', scheduledFor: null, lastActivityAt: new Date() } })
      await db.job.update({ where: { id: app.jobId }, data: { status: 'SKIPPED' } })
      await db.portalAttempt.updateMany({ where: { applicationId, status: { in: ['NEEDS_HUMAN', 'AWAITING_REVIEW', 'QUEUED'] } }, data: { status: 'CANCELLED', error: 'Skipped by you from the panel', tabId: null, finishedAt: new Date() } })
      if (args.note) await addNote(applicationId, `Skipped: ${args.note}`)
      closeSoon(page)
      return `Skipped ${app.job.title} at ${app.job.companyName}. It leaves Needs you and is never applied to. Closing the tab.`
    }
    case 'mark_submitted':
      await markSubmittedByHand(applicationId, 'Sent by you; recorded from the panel on the form', { formUrl: page.url() })
      closeSoon(page)
      return `Recorded: you applied to ${app.job.companyName}. It will never be applied to twice. Closing the tab.`
    case 'save_answer': {
      const q = args.question?.trim()
      const a = args.answer?.trim()
      if (!q || !a) return 'Tell me the question and your answer, for example: "remember: notice period is 2 months".'
      const saved = await learnFromYou(q, 'text', [], a, app.job.companyName)
      return saved ? `Saved for every form: "${q}" → "${a}".` : `I already have "${a}" for "${q}" (or it is a standard field from your profile, which you change in Settings → Profile).`
    }
    case 'open_clean': {
      const r = await openInCleanChrome(page.url())
      if (!r.ok) return r.error
      await addNote(applicationId, 'Opened in a clean Chrome (the bot check rejects the controlled browser)')
      return 'Opened this form in a separate clean Chrome window (no automation bar); it comes to the front, or look for a second Chrome icon in the taskbar. Fill it there, copying from this tab, then press "I submitted it" here.'
    }
    case 'note': {
      const note = args.note?.trim()
      if (!note) return 'What should I note on this application?'
      await addNote(applicationId, note)
      return `Noted on the ${app.job.companyName} application: "${note}".`
    }
    default:
      return ''
  }
}
