import { leads, needsAction } from '@/lib/email/needs-action'
import { appLink, truncate } from '../format'
import { defineCommand } from '../registry'

const LABEL: Record<string, string> = {
  INTERVIEW_REQUEST: 'interview request',
  NEEDS_INFO: 'asks for info',
  POSITIVE: 'positive',
  LOCATION_ISSUE: 'location',
  APPLY_VIA_PORTAL: 'apply on their site',
  OTHER: 'other',
}

export const replies = defineCommand({
  name: 'replies',
  description: 'Replies waiting for your answer, with the next steps',
  usage: '/replies',
  group: 'Mail',
  risk: 'read',
  async handler({ now }) {
    const [{ needsYou }, { nextSteps }] = await Promise.all([needsAction(now), leads(now)])
    const open = nextSteps.filter((l) => !l.answered && !['REJECTED', 'SKIPPED'].includes(l.status))
    const lines = [`**${needsYou.length} repl${needsYou.length === 1 ? 'y waits' : 'ies wait'} for your answer**, ${open.length} next step${open.length === 1 ? '' : 's'}`]
    needsYou.slice(0, 8).forEach((n, i) => {
      lines.push(`${i + 1}. ${n.job.companyName} - ${LABEL[n.classification] ?? n.classification.toLowerCase()}, ${n.ageDays} d`)
      const next = n.suggestedNextAction ?? n.summary
      if (next) lines.push(`   ${truncate(next, 140)}`)
      lines.push(`   ${appLink(`/applications/${n.applicationId}`)}`)
    })
    if (needsYou.length > 8) lines.push(`...and ${needsYou.length - 8} more`)
    lines.push('', appLink('/mail'))
    return lines.join('\n')
  },
})
