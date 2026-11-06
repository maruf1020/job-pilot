import { releaseReady, scanReleasable, MIN_SCORE } from '../release'
import { defineCommand, type Preview } from '../registry'

export const sendready = defineCommand({
  name: 'sendready',
  description: 'Queue the held emails that pass every check and Gemini fit',
  usage: '/sendready',
  group: 'Mail',
  risk: 'outward',
  async preview({ reply }): Promise<Preview> {
    await reply('Checking the held emails (addresses, cooldown, Gemini fit)...')
    const scan = await scanReleasable()
    const heldTop = Object.entries(scan.held)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${v} ${k}`)
    if (scan.ready.length === 0) return { text: `0 of ${scan.total} held emails are ready.${heldTop.length ? `\nHeld: ${heldTop.join(', ')}.` : ''}`, proceed: false }
    const lines = [
      `**${scan.ready.length} emails would be queued** (of ${scan.total} held in Review and Draft).`,
      `Each has an address the app found, score ${MIN_SCORE} or more, a Gemini fit, and a draft that passed the checks.`,
      `Held back: ${heldTop.join(', ') || 'none'}.${scan.needsDraft ? ` ${scan.needsDraft} more need a new draft first (left as they are).` : ''}`,
      'Queuing still goes through the daily cap, block list, company cooldown, same-job rule and send window.',
    ]
    return { text: lines.join('\n'), proceed: true }
  },
  async handler({ reply }) {
    await reply('Queuing...')
    const scan = await scanReleasable()
    const r = await releaseReady(scan)
    const refused = Object.entries(r.refused).map(([k, v]) => `${v} ${k}`)
    return [`**Queued ${r.queued}** of ${scan.ready.length}.`, ...(refused.length ? [`Not queued: ${refused.join(', ')}.`] : []), 'They go out at their send times; /sendnow can speed them up.'].join('\n')
  },
})
