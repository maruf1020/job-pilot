import type { Page } from 'playwright'
import { z } from 'zod'
import { generateJson } from '@/lib/ai/gemini'
import { db } from '@/lib/db'
import { loadCandidateContext } from '@/lib/candidate/load'
import type { CandidateContext } from '@/lib/candidate/context'
import { getProfileForPrompt } from '@/lib/pipeline/profile'
import { loadAnswerBank } from './answer-bank'
import { driveWithGemini } from './driver'
import { coverLetterPdfPath, resumeFilePath } from './files'
import { runInFrame } from './inpage'
import { relevantFields, scanPage } from './navigate'
import { chatInPage, type ChatMessage } from './panel-chat'
import { PANEL_COMMANDS, quickCommand, runPanelCommand } from './panel-commands'

/**
 * Instructions the person types into the panel on a form ("pick Portugal as country", "answer the visa
 * question No", "press Submit"): the page calls window.__jfAsk(text) through a Playwright binding, the
 * attempt or hand-over watcher that owns the tab runs them with the screenshot driver, and the reply shows
 * in the panel, so what the person spots can be fixed without leaving the tab.
 */

export type AskHandler = (text: string) => Promise<string>

/** Who answers the panel on each page right now (the attempt while it runs, then the watcher). */
const owners = new WeakMap<Page, AskHandler>()
/** Pages that already carry the binding (it can be exposed once per page). */
const bound = new WeakSet<Page>()

export async function listenForAsks(page: Page, handler: AskHandler): Promise<void> {
  owners.set(page, handler)
  if (bound.has(page) || page.isClosed()) return
  bound.add(page)
  await page
    .exposeBinding('__jfAsk', async (_source, text: unknown) => {
      const h = owners.get(page)
      if (!h) return 'Nobody is working on this tab right now. Open it again with AI from Needs you.'
      try {
        return await h(String(text ?? '').trim().slice(0, 1000))
      } catch (err) {
        return `Could not do it: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : err}`
      }
    })
    .catch(() => bound.delete(page))
}

/** The owner hands the tab on (or is done with it). */
export function stopListening(page: Page, handler?: AskHandler): void {
  if (!handler || owners.get(page) === handler) owners.delete(page)
}

/** "dont click on submit button please", "dony hit submit application": the person wants to send it themselves. */
export function asksNotToSubmit(text: string): boolean {
  return /\b(don'?t|dont|dony|dnt|donot|do not|never|without|stop before|wait before|hold off)\b.{0,30}\b(submit|send|apply)/i.test(text)
}

/** Whether the user's words ask for the application to go out now. */
export function asksToSubmit(text: string): boolean {
  if (asksNotToSubmit(text)) return false
  return /\b(submit|send (it|the application)|apply now|finish (it|the application)|press (the )?(submit|apply|send))\b/i.test(text)
}

/**
 * Do what the person asked on this page with the screenshot driver (a screenshot and the page each step, at
 * most a few steps), and say in one line what happened. Submit is pressed only when they asked for it.
 */
export async function followInstruction(
  page: Page,
  text: string,
  opts: {
    applicationId: string
    log: (m: string) => void
    onAiCall?: () => void
    maxSteps?: number
    /** The files the attempt already has; otherwise the CV and this application's cover letter as a PDF. */
    files?: { cvPath: string | null; coverLetterPath: string | null }
    /** What the person asked earlier on this form, still in force. */
    earlier?: string[]
  },
): Promise<string> {
  if (!text) return 'Type what the AI should do on this page, then press Do it.'
  if (page.isClosed()) return 'The tab is closed.'
  const app = await db.application.findUnique({
    where: { id: opts.applicationId },
    select: { id: true, coverLetter: true, job: { select: { title: true, companyName: true, countryCode: true } } },
  })
  if (!app) return 'This application is gone.'
  const [profile, bank, me] = await Promise.all([getProfileForPrompt(), loadAnswerBank(), db.candidateProfile.findUnique({ where: { id: 1 }, select: { email: true } })])
  // "Use the cover letter in the cover letter section": without the file, it could only remove the CV.
  const files = opts.files ?? {
    cvPath: await resumeFilePath().catch(() => null),
    coverLetterPath: app.coverLetter ? await coverLetterPdfPath(app.id, app.coverLetter, profile.fullName, app.job.companyName).catch(() => null) : null,
  }
  const submit = asksToSubmit(text) && !(opts.earlier ?? []).some(asksNotToSubmit)
  const before = (opts.earlier ?? []).filter((e) => e !== text)
  opts.log(`asked in the panel: "${text.slice(0, 120)}"`)
  // Each of Gemini's steps shows on the panel's "thinking" line while it works.
  const log = (m: string) => {
    opts.log(m)
    const step = /^gemini step (\d+) \[[^\]]*\]: (.*)$/.exec(m)
    if (step) void think(page, `Step ${step[1]}: ${step[2].slice(0, 160)}`)
  }
  const r = await driveWithGemini({
    page,
    why: `The applicant is looking at this tab and asks you to: "${text}". Do exactly that, completely, on this page and nothing else (upload_cv and upload_cover_letter put their CV or their cover letter into an upload box: a wrong file is removed first, then the right one is uploaded). When it is done, answer status needs_human with reason "Done: <what you changed>". If it cannot be done, status needs_human with the reason.${before.length ? ` Earlier on this form they said: ${before.map((e) => `"${e}"`).join('; ')}; that still holds.` : ''}${submit ? ' They asked for Submit: press it when everything is filled.' : ' Do not press Submit.'}`,
    job: { title: app.job.title, company: app.job.companyName, countryCode: app.job.countryCode },
    bank,
    email: me?.email ?? '',
    fullName: profile.fullName,
    profile,
    coverLetter: app.coverLetter,
    cvPath: files.cvPath,
    coverLetterPath: files.coverLetterPath,
    mayPressSubmit: submit,
    maxSteps: opts.maxSteps ?? 6,
    log,
    onAiCall: opts.onAiCall,
  })
  if (r.status === 'submitted') return `Submitted: ${r.reason.slice(0, 200)}`
  return r.reason.replace(/^Gemini (worked|tried).*?:\s*/i, '').slice(0, 300) || 'Done.'
}

async function think(page: Page, text: string | null) {
  if (!page.isClosed()) await runInFrame(page.mainFrame(), chatInPage, { thinking: text }).catch(() => undefined)
}

/** The conversation on each application's form, for context (the page keeps its own copy to draw). */
const threads = new Map<string, ChatMessage[]>()

const chatTurnSchema = z.object({
  reply: z.string(),
  act: z.boolean(),
  instruction: z.string().default(''),
  command: z.enum(PANEL_COMMANDS).default('none'),
  note: z.string().default(''),
  question: z.string().default(''),
  answer: z.string().default(''),
})

/** Who the panel AI works for: the applicant's name and pronouns from the profile, when known. */
export function panelChatIntro(me: Pick<CandidateContext, 'fullName' | 'pronouns'> | null): string {
  const who = me?.fullName ? `${me.fullName}${me.pronouns ? ` (${me.pronouns})` : ''}` : 'the applicant'
  return `You are the AI in the Job Pilot panel on a job application form, filling it for ${who}. The user (the applicant) chats with you while you work; their messages may have typos, read the intent.`
}

/**
 * One turn of the panel chat. The person may ask ("what is left?", "what salary did you put?") or ask for
 * something to be done ("pick Portugal"): the AI reads the page and the conversation, answers, and turns
 * a request into an instruction for the screenshot driver. `act` does it now (they are waiting); otherwise
 * `queue` keeps it for the next pause in the filling.
 */
export async function converse(
  page: Page,
  text: string,
  opts: {
    applicationId: string
    log: (m: string) => void
    onAiCall?: () => void
    act: (instruction: string) => Promise<string>
    actNow: boolean
    queue?: (instruction: string) => void
  },
): Promise<string> {
  if (!text) return 'Write a question or what I should do on this page.'
  if (page.isClosed()) return 'The tab is closed.'
  const remember = (reply: string) => {
    const history = threads.get(opts.applicationId) ?? []
    threads.set(opts.applicationId, [...history, { role: 'you' as const, text }, { role: 'ai' as const, text: reply }].slice(-12))
    opts.log(`panel chat: "${text.slice(0, 80)}" -> ${reply.slice(0, 160)}`)
    return reply
  }
  // The panel's quick buttons and short orders ("close this tab") need no AI call.
  const quick = quickCommand(text)
  if (quick) return remember(await runPanelCommand(page, opts.applicationId, quick.command, quick.args, opts.log))
  await think(page, 'Reading the page...')
  const app = await db.application.findUnique({ where: { id: opts.applicationId }, select: { job: { select: { title: true, companyName: true } } } })
  const { scan } = await scanPage(page).catch(() => ({ scan: null }))
  const fields = scan
    ? relevantFields(scan)
        .filter((f) => f.visible || f.kind === 'file')
        .slice(0, 40)
        .map((f) => `- ${f.label.slice(0, 90)}${f.required ? ' (required)' : ''}: ${f.kind === 'file' ? f.value || '(no file)' : f.value.slice(0, 80) || '(empty)'}${f.error ? ` [error: ${f.error.slice(0, 80)}]` : ''}`)
    : []
  const guide = await page
    .evaluate(() => {
      const b = document.getElementById('jf-handover')
      return b ? `${b.firstElementChild?.textContent ?? ''}\n${b.querySelector('ol')?.innerText ?? ''}` : ''
    })
    .catch(() => '')
  const history = (threads.get(opts.applicationId) ?? []).slice(-8)
  const me = await loadCandidateContext().catch(() => null)
  await think(page, 'Thinking...')
  opts.onAiCall?.()
  const r = await generateJson({
    task: 'panel_chat',
    model: 'lite',
    schema: chatTurnSchema,
    temperature: 0.3,
    maxOutputTokens: 500,
    system:
      panelChatIntro(me) +
      ' Reply like a helpful colleague: plain, friendly, 1 to 3 short sentences, first person. If the user asks a question, answer it from the page fields, the panel and the conversation below; say plainly when you do not know. If the user asks you to do something on this page (fill, change, choose, upload, remove, click, go to a step, submit), set act=true and write instruction: one precise instruction for the browser agent, with the exact values. reply then says what you are about to do. Never say you did something that is not done yet. Questions about other jobs or the app: answer briefly from what you know or say you only see this form.\n' +
      'You can also act on this application and tab with command (leave act=false then): close_tab = the user wants this tab closed now ("close this tab"); later = the user will finish it later, put what is still to do in note ("I have to record the video first" -> note "record the 1-minute intro video and add its link"), the tab closes and stays in their list; skip_job = the user does not want this job ("skip it", "not interested"), reason in note; mark_submitted = the user says they already sent this application themselves; save_answer = the user gives an answer to keep for every form ("remember my notice period is 2 months" -> question "notice period", answer "2 months"); note = something to remember about this application only; open_clean = the user wants this form in a separate, clean Chrome window ("open a new separate chrome", or the site keeps saying it could not verify the application). Use a command only when the user clearly asks for it; otherwise command none. Answer ONLY with JSON.',
    prompt: [
      `Job: ${app?.job.title ?? '?'} at ${app?.job.companyName ?? '?'}`,
      `Page: ${page.url()}`,
      guide ? `The panel shows:\n${guide.slice(0, 800)}` : '',
      `Form fields now:\n${fields.join('\n') || '(none found)'}`,
      scan?.errors.length ? `Errors on the page: ${scan.errors.slice(0, 6).join(' | ')}` : '',
      history.length ? `Conversation so far:\n${history.map((m) => `${m.role === 'you' ? 'User' : 'You'}: ${m.text.slice(0, 300)}`).join('\n')}` : '',
      `New message from the user: ${text}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  }).catch((err: unknown) => {
    opts.log(`panel chat failed: ${err instanceof Error ? err.message.split('\n')[0] : err}`)
    return null
  })
  const turn = r?.data ?? { reply: 'I could not think that through just now; I will try it as an instruction.', act: true, instruction: text, command: 'none' as const, note: '', question: '', answer: '' }
  let reply = turn.reply.trim()
  if (turn.command !== 'none') {
    const done = await runPanelCommand(page, opts.applicationId, turn.command, { note: turn.note, question: turn.question, answer: turn.answer }, opts.log)
    threads.set(opts.applicationId, [...history, { role: 'you' as const, text }, { role: 'ai' as const, text: done }].slice(-12))
    opts.log(`panel chat: "${text.slice(0, 80)}" -> ${done.slice(0, 160)}`)
    return done
  }
  if (turn.act && turn.instruction.trim()) {
    const instruction = turn.instruction.trim()
    if (opts.actNow) {
      await think(page, reply || 'Working on it...')
      const done = await opts.act(instruction)
      reply = /^(done|submitted)\b/i.test(done) ? done : `I could not finish it: ${done}`
    } else {
      opts.queue?.(instruction)
      reply = `${reply} I'll do it as soon as I finish the field I'm on, and tell you here.`.trim()
    }
  }
  threads.set(opts.applicationId, [...history, { role: 'you' as const, text }, { role: 'ai' as const, text: reply }].slice(-12))
  opts.log(`panel chat: "${text.slice(0, 80)}" -> ${reply.slice(0, 160)}`)
  return reply
}
