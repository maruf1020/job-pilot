import { enqueueSearchRun } from '@/lib/queue'
import { defineCommand } from '../registry'

export const search = defineCommand({
  name: 'search',
  description: 'Queue a job search run now',
  usage: '/search',
  group: 'Run',
  risk: 'action',
  async handler() {
    const id = await enqueueSearchRun({ trigger: 'MANUAL' })
    return id ? 'Search run queued. It starts within seconds if the search worker is up; /status shows it.' : 'A search run is already queued or running.'
  },
})
