import { pauseBatches } from '../control'
import { defineCommand } from '../registry'

export const pause = defineCommand({
  name: 'pause',
  description: 'Stop new claims on the browser and email batches (workers keep running)',
  usage: '/pause',
  group: 'Control',
  risk: 'action',
  async handler({ now }) {
    const r = await pauseBatches(now)
    if (!r.browser && !r.email) return 'No batch is running, so there is nothing to pause.'
    return [`Paused: ${[r.browser ? `browser batch ${r.browser}` : null, r.email ? `email batch ${r.email}` : null].filter(Boolean).join(' and ')}.`, 'Work already started finishes. Send /resume to continue.'].join('\n')
  },
})
