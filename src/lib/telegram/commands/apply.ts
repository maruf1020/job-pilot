import { browserPool, resumeBrowser } from '../control'
import { defineCommand } from '../registry'

export const apply = defineCommand({
  name: 'apply',
  description: 'Resume the browser batch and report the eligible pool',
  usage: '/apply',
  group: 'Run',
  risk: 'action',
  async handler() {
    const batch = await resumeBrowser()
    const pool = await browserPool()
    return [
      batch ? `Browser batch ${batch} resumed.` : 'No browser batch is running; start one in the app (Applications, Browser batch).',
      `Eligible pool: ${pool.eligible} jobs (score ${pool.minScore} or more, one per company, cooldown respected).`,
    ].join('\n')
  },
})
