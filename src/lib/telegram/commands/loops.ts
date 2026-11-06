import fs from 'node:fs'
import path from 'node:path'
import { loopStatuses } from '@/lib/mail/loops'
import { truncate } from '../format'
import { defineCommand } from '../registry'

const LOG_FILE = () => path.resolve(process.cwd(), 'storage', 'logs', 'supervisor-rounds.log')

/** The last lines of the log, each cut to a phone-friendly length. */
export function tailLines(text: string, count: number): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(-count)
    .map((l) => truncate(l, 200))
}

export const loops = defineCommand({
  name: 'loops',
  description: 'Last lines of the supervisor loops log',
  usage: '/loops',
  group: 'Overview',
  risk: 'read',
  async handler({ now }) {
    let text: string
    try {
      text = fs.readFileSync(LOG_FILE(), 'utf8')
    } catch {
      return 'No supervisor log yet (storage/logs/supervisor-rounds.log).'
    }
    const state = loopStatuses(text, now)
      .map((l) => `${l.id} (every ${l.intervalMin} min): ${l.ageMin === null ? 'no round yet' : `${l.ageMin} min ago`}${l.late ? ' LATE' : ''}`)
      .join('\n')
    return `**Supervisor loops**\n${state}\n\nLast lines:\n${tailLines(text, 6).join('\n')}`
  },
})
