import { opportunities } from '@/lib/applications/opportunities'
import { appLink, truncate } from '../format'
import { defineCommand } from '../registry'

export const todo = defineCommand({
  name: 'todo',
  description: 'What needs you now (top 10 with links)',
  usage: '/todo',
  group: 'Overview',
  risk: 'read',
  async handler({ now }) {
    const { todo: items } = await opportunities(now)
    if (!items.length) return 'Nothing needs you right now.'
    const lines = [`**${items.length} thing${items.length === 1 ? '' : 's'} need you**`]
    items.slice(0, 10).forEach((t, i) => {
      lines.push(`${i + 1}. ${t.priority === 'urgent' ? '[urgent] ' : ''}${truncate(t.title, 110)}`)
      lines.push(appLink(t.href))
    })
    if (items.length > 10) lines.push(`...and ${items.length - 10} more: ${appLink('/opportunities')}`)
    return lines.join('\n')
  },
})
