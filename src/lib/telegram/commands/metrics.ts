import { metricExamples } from '../analytics'
import { defineCommand } from '../registry'
import { getTimezone, tzLabel } from '../tz'

export const metrics = defineCommand({
  name: 'metrics',
  description: 'Example questions /ask and /ai understand',
  usage: '/metrics',
  group: 'Ask',
  risk: 'read',
  handler: async () => {
    const tz = await getTimezone()
    return ['**Questions you can ask** (/ask <q> for these, /ai <q> or plain text for anything)', ...metricExamples().flatMap((m) => m.examples.slice(0, 2).map((e) => `- ${e}`)), '', `Periods: today (${tzLabel(tz)}), 24h, 7d, 30d, all.`].join('\n')
  },
})
