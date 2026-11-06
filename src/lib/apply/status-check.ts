import type { Prisma } from '@/generated/prisma/client'
import { generateJson } from '@/lib/ai/gemini'
import { portalStatusSchema, type PortalStatusOutput } from '@/lib/ai/schemas'
import { connectApplyBrowser } from '@/lib/browser/chrome'
import { db } from '@/lib/db'
import type { ApplicationStatus } from '@/lib/domain'
import { notify } from '@/lib/notifications'
import { getSettings } from '@/lib/settings/service'
import { normalizeQuestion } from './match'
import { isLoginPage, scanPage, settle } from './navigate'
import { isWorkdayUrl, workdaySignIn } from './workday'

/**
 * Daily check of candidate portals (Workday "My applications"): open the page in the apply
 * browser (your saved login), read the status next to each job and update the application.
 */

const json = (v: unknown) => v as Prisma.InputJsonValue
type PortalState = PortalStatusOutput['status']

/** Status words shown right after the job title on a candidate portal page (pure, unit-tested). */
export function parsePortalStatus(pageText: string, jobTitle: string): { status: PortalState; evidence: string } | null {
  const text = pageText.replace(/\s+/g, ' ')
  const lower = text.toLowerCase()
  const title = jobTitle.toLowerCase().replace(/\s+/g, ' ').trim()
  let at = lower.indexOf(title)
  if (at < 0) {
    // Titles are sometimes shortened; fall back to the first four words.
    const short = normalizeQuestion(jobTitle).split(' ').slice(0, 4).join(' ')
    at = short.length >= 8 ? normalizeQuestion(text).indexOf(short) : -1
    if (at < 0) return null
  }
  const win = lower.slice(at, at + title.length + 260)
  const rules: Array<[RegExp, PortalState]> = [
    [/no longer (under )?consider|not selected|not moving forward|unsuccessful|rejected|declined|position (has been )?filled|not progressing/, 'REJECTED'],
    [/withdrawn|withdrew/, 'WITHDRAWN'],
    [/job (posting )?(closed|expired)|requisition closed|position closed/, 'CLOSED'],
    [/offer/, 'OFFER'],
    [/interview|assessment|phone screen/, 'INTERVIEW'],
    [/under consideration|in review|under review|reviewing|in progress|screening|being reviewed/, 'IN_REVIEW'],
    // "Submitted 10/23/2026" is the date column, not a status.
    [/application received|submitted(?!\s*:?\s*\d)/, 'SUBMITTED'],
  ]
  // The status closest after the title wins (the next row's status comes later).
  let best: { index: number; status: PortalState } | null = null
  for (const [re, status] of rules) {
    const m = re.exec(win.slice(title.length))
    if (m && (!best || m.index < best.index)) best = { index: m.index, status }
  }
  return best ? { status: best.status, evidence: text.slice(at, at + title.length + best.index + 40).trim() } : null
}

const MOVE: Partial<Record<PortalState, ApplicationStatus>> = { REJECTED: 'REJECTED', INTERVIEW: 'INTERVIEW', OFFER: 'OFFER', CLOSED: 'REJECTED', WITHDRAWN: 'SKIPPED' }

export async function checkPortalStatuses(log: (m: string) => void = console.log): Promise<number> {
  const settings = await getSettings()
  if (!settings.portal.enabled || !settings.portal.statusCheck) return 0
  const due = await db.application.findMany({
    where: {
      portalStatusUrl: { not: null },
      status: { in: ['SENT', 'REPLIED', 'INTERVIEW', 'NO_RESPONSE'] },
      OR: [{ portalCheckedAt: null }, { portalCheckedAt: { lt: new Date(Date.now() - 20 * 3_600_000) } }],
    },
    select: { id: true, status: true, portalStatusUrl: true, job: { select: { title: true, companyName: true } } },
    take: 60,
  })
  if (due.length === 0) return 0
  const email = (await db.candidateProfile.findUnique({ where: { id: 1 }, select: { email: true } }))?.email ?? ''
  const byUrl = new Map<string, typeof due>()
  for (const a of due) byUrl.set(a.portalStatusUrl!, [...(byUrl.get(a.portalStatusUrl!) ?? []), a])

  const { context } = await connectApplyBrowser(settings.portal)
  let updated = 0
  for (const [url, apps] of byUrl) {
    const page = await context.newPage()
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await settle(page, 1500)
      let { scan } = await scanPage(page)
      if (isLoginPage(scan) && isWorkdayUrl(url)) {
        await workdaySignIn(page, email, log)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await settle(page, 2000)
        ;({ scan } = await scanPage(page))
      }
      const text = await page.evaluate(() => document.body.innerText).catch(() => scan.textSample)
      for (const a of apps) {
        let found: { status: PortalState; evidence: string } | null = parsePortalStatus(text, a.job.title)
        if (!found) {
          const r = await generateJson({
            task: 'portal_status',
            model: 'lite',
            schema: portalStatusSchema,
            temperature: 0,
            maxOutputTokens: 500,
            system: 'You read a job candidate portal page and report the status of one application. Answer ONLY with JSON.',
            prompt: `Application: "${a.job.title}" at ${a.job.companyName}\n\nPage text:\n${text.slice(0, 9000)}`,
          }).catch(() => null)
          found = r?.data.found ? { status: r.data.status, evidence: r.data.evidence } : null
        }
        await db.application.update({ where: { id: a.id }, data: { portalCheckedAt: new Date() } })
        if (!found) continue
        const last = await db.applicationEvent.findFirst({ where: { applicationId: a.id, type: 'status' }, orderBy: { createdAt: 'desc' } })
        const lastStatus = (last?.meta as { status?: string } | null)?.status
        if (lastStatus === found.status) continue
        await db.applicationEvent.create({ data: { applicationId: a.id, type: 'status', message: `Portal says: ${found.evidence.slice(0, 200)}`, meta: json({ status: found.status, url }) } })
        const next = MOVE[found.status]
        if (next && next !== a.status) {
          await db.application.update({ where: { id: a.id }, data: { status: next, lastActivityAt: new Date(), ...(next === 'INTERVIEW' || next === 'OFFER' || next === 'REJECTED' ? { repliedAt: new Date() } : {}) } })
          await notify(next === 'INTERVIEW' ? 'interview' : 'reply', `${a.job.companyName} portal: ${found.status.toLowerCase().replace('_', ' ')}`, `${a.job.title}: ${found.evidence.slice(0, 200)}`, `/applications/${a.id}`)
        }
        updated++
        log(`${a.job.companyName}: ${found.status}`)
      }
    } catch (err) {
      log(`status check failed for ${url}: ${err instanceof Error ? err.message.split('\n')[0] : err}`)
    } finally {
      await page.close().catch(() => undefined)
    }
  }
  return updated
}
