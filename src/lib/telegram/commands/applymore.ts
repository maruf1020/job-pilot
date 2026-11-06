import { db } from '@/lib/db'
import { BatchAlreadyRunningError, createContactBatch } from '@/lib/pipeline/contact-batch'
import { enqueueContactBatch, enqueueSearchRun } from '@/lib/queue'
import { getSettings } from '@/lib/settings/service'
import { browserPool, resumeBrowser } from '../control'
import { appLink } from '../format'
import { defineCommand } from '../registry'

export const applymore = defineCommand({
  name: 'applymore',
  description: 'Search + contact lookup + resume the browser batch, then report the pool',
  usage: '/applymore',
  group: 'Run',
  risk: 'action',
  async handler() {
    const done: string[] = []
    const searched = await enqueueSearchRun({ trigger: 'MANUAL' }).catch(() => null)
    done.push(searched ? 'search run queued' : 'a search run is already queued or running')
    try {
      const run = await createContactBatch('above_threshold', 10, false)
      await enqueueContactBatch({ runId: run.id, includeChecked: false })
      done.push(`contact lookup started (${run.total} companies)`)
    } catch (err) {
      done.push(err instanceof BatchAlreadyRunningError ? 'a contact lookup is already running' : 'contact lookup not started')
    }
    const batch = await resumeBrowser()
    done.push(batch ? `browser batch ${batch} resumed` : 'no browser batch running')
    const pool = await browserPool()
    const lines = [`**Pool: ${pool.eligible} eligible jobs** (score ${pool.minScore}+)`, ...done.map((d) => `- ${d}`)]
    if (pool.eligible === 0) {
      const settings = await getSettings()
      const ranked = await db.job.count({ where: { status: { in: ['RANKED', 'REVIEW'] }, finalScore: { gte: pool.minScore }, company: { blacklisted: false } } })
      lines.push('', 'Why nothing is eligible:')
      if (!pool.batchRunning) lines.push('- No browser batch is running. Start one in the app.')
      if (!settings.portal.enabled) lines.push('- The browser agent is switched off in Settings.')
      lines.push(`- ${ranked} ranked jobs reach the score, but each is blocked by the 15-day company cooldown, the same-job rule, an application already in flight, your stack or title rules, or a site that rarely finishes.`)
      lines.push('- The new search and contact lookup can add fresh ones; try /applymore again in a few minutes.', appLink('/applications'))
    }
    return lines.join('\n')
  },
})
