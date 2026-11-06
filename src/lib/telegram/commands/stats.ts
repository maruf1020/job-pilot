import { db } from '@/lib/db'
import { countApplications } from '../analytics'
import { getTimezone, periodLabel, type Period } from '../tz'
import { appLink } from '../format'
import { defineCommand } from '../registry'

const PERIODS: Period[] = ['today', '24h', '7d']

export const stats = defineCommand({
  name: 'stats',
  description: 'Applications sent today, 24 h and 7 days, by browser and email',
  usage: '/stats',
  group: 'Overview',
  risk: 'read',
  async handler({ now }) {
    const tz = await getTimezone()
    const rows = await Promise.all(
      PERIODS.map(async (period) => {
        const [email, browser] = await Promise.all([countApplications(db, { period, channel: 'email', status: 'sent' }, now, tz), countApplications(db, { period, channel: 'browser', status: 'sent' }, now, tz)])
        const label = periodLabel(period, tz)
        return `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${email + browser} (${browser} browser, ${email} email)`
      }),
    )
    return ['**Applications sent**', ...rows, '', appLink('/stats')].join('\n')
  },
})
