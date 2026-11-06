import { resumeBrowser, resumeEmail } from '../control'
import { defineCommand } from '../registry'

export const resume = defineCommand({
  name: 'resume',
  description: 'Start new claims again on the browser and email batches',
  usage: '/resume',
  group: 'Control',
  risk: 'action',
  async handler() {
    const [browser, email] = await Promise.all([resumeBrowser(), resumeEmail()])
    if (!browser && !email) return 'No batch is running, so there is nothing to resume.'
    return `Resumed: ${[browser ? `browser batch ${browser}` : null, email ? `email batch ${email}` : null].filter(Boolean).join(' and ')}.`
  },
})
