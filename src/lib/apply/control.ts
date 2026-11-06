import { connectApplyBrowser, findTab, getBrowserStatus, launchApplyBrowser } from '@/lib/browser/chrome'
import { db } from '@/lib/db'
import type { BrowserControlJob } from '@/lib/queue'
import { getSettings } from '@/lib/settings/service'

/** Worker side of the browser buttons in the UI: open the browser, show or close an attempt's tab. */
export async function browserControl(job: BrowserControlJob, log: (m: string) => void): Promise<void> {
  const cfg = (await getSettings()).portal
  if (job.action === 'open') {
    const r = await launchApplyBrowser(cfg, job.url ?? 'about:blank')
    if (!r.launched && job.url) {
      const { context } = await connectApplyBrowser(cfg)
      const page = await context.newPage()
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined)
      await page.bringToFront().catch(() => undefined)
    }
    log(r.launched ? 'apply browser opened' : 'apply browser already open')
    return
  }
  if (!job.attemptId) return
  const attempt = await db.portalAttempt.findUnique({ where: { id: job.attemptId } })
  if (!attempt) return
  const { context } = await connectApplyBrowser(cfg)
  const tab = await findTab(context, attempt.tabId)
  if (job.action === 'close-tab') {
    await tab?.close().catch(() => undefined)
    await db.portalAttempt.update({ where: { id: attempt.id }, data: { tabId: null } })
    return
  }
  // focus: bring the tab to the front, or reopen the last page when the tab is gone.
  if (tab) {
    await tab.bringToFront().catch(() => undefined)
    return
  }
  const url = attempt.finalUrl ?? attempt.formUrl ?? attempt.startUrl
  if (url) {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined)
    await page.bringToFront().catch(() => undefined)
  }
}

/** Heartbeat payload: what the worker sees of the apply browser (HTTP probe only). */
export async function browserHeartbeat() {
  const cfg = (await getSettings()).portal
  return getBrowserStatus(cfg)
}
