import type { PgBoss } from 'pg-boss'
import { SOURCE_IDS, type SourceId } from '@/lib/domain'
import { QUEUES, type SearchRunJob } from '@/lib/queue'
import { getSettings } from '@/lib/settings/service'
import { runsApplySide, runsSearchSide, type WorkerRole } from './roles'

/** Interval in minutes → a cron expression pg-boss can run in the given timezone. */
export function intervalToCron(minutes: number): string {
  const m = Math.max(5, Math.round(minutes))
  if (m < 60) return `*/${Math.min(59, m)} * * * *`
  const hours = Math.round(m / 60)
  if (hours <= 23) return `0 */${hours} * * *`
  const days = Math.max(1, Math.round(hours / 24))
  return `0 9 */${days} * *`
}

/** Sources a light run reads: company boards and the feeds that flag visa sponsorship. */
export const LIGHT_RUN_SOURCES = ['ats', 'arbeitnow', 'arbeitnow_uk', 'freehire', 'hn'] as const

/** The light-run sources this build knows (a source added later simply joins once it exists). */
export function lightRunSources(): SourceId[] {
  return LIGHT_RUN_SOURCES.filter((id) => (SOURCE_IDS as readonly string[]).includes(id)) as SourceId[]
}

/**
 * Cron for the light board runs: every `everyMinutes`, half an interval (at most 30 minutes) after the
 * full run's slots so the two never start in the same minute (the second one would be skipped as
 * "already running"). Null when off, or when it would not run more often than the full search.
 */
export function boardsRunCron(everyMinutes: number, fullIntervalMinutes: number): string | null {
  const m = Math.max(0, Math.round(everyMinutes))
  if (m === 0) return null
  if (m >= Math.max(5, Math.round(fullIntervalMinutes))) return null
  const every = Math.max(10, m)
  if (every < 60) {
    const offset = Math.floor(every / 2)
    const minutes: number[] = []
    for (let x = offset; x < 60; x += every) minutes.push(x)
    return `${minutes.join(',')} * * * *`
  }
  const hours = Math.round(every / 60)
  if (hours <= 23) return `30 */${hours} * * *`
  return null
}

export async function syncSchedules(boss: PgBoss, role: WorkerRole = 'all'): Promise<string> {
  const s = await getSettings()
  const tz = s.timezone || 'UTC'
  const parts: string[] = []

  if (runsSearchSide(role)) {
    if (s.searchEnabled) {
      const cron = intervalToCron(s.searchIntervalMinutes)
      await boss.schedule(QUEUES.searchRun, cron, { trigger: 'SCHEDULED' }, { tz, singletonKey: 'search-run' })
      parts.push(`search "${cron}" (${tz})`)
      const boards = boardsRunCron(s.search.boardsRunEveryMinutes, s.searchIntervalMinutes)
      if (boards) {
        const data: SearchRunJob = { trigger: 'SCHEDULED', light: true, sources: lightRunSources() }
        await boss.schedule(QUEUES.searchBoards, boards, data, { tz, singletonKey: 'search-boards' })
        parts.push(`board runs "${boards}"`)
      } else await boss.unschedule(QUEUES.searchBoards)
    } else {
      await boss.unschedule(QUEUES.searchRun)
      await boss.unschedule(QUEUES.searchBoards)
      parts.push('search off')
    }

    await boss.schedule(QUEUES.mailDispatch, '* * * * *', {}, { tz: 'UTC', singletonKey: 'mail-dispatch' })
    const poll = Math.max(5, Math.min(59, s.email.replyPollMinutes))
    await boss.schedule(QUEUES.mailPoll, `*/${poll} * * * *`, {}, { tz: 'UTC', singletonKey: 'mail-poll' })
    parts.push(`dispatch every minute, poll every ${poll}m`)
    // Auto-apply batches prepare the next applications every few minutes (no-op when none is running).
    await boss.schedule(QUEUES.applyBatch, '* * * * *', {}, { tz: 'UTC', singletonKey: 'apply-batch' })

    if (s.portal.inboxScan) {
      await boss.schedule(QUEUES.inboxScan, `*/${poll} * * * *`, {}, { tz: 'UTC', singletonKey: 'inbox-scan' })
      parts.push(`inbox scan every ${poll}m`)
    } else {
      await boss.unschedule(QUEUES.inboxScan)
    }

    if (s.digestEnabled) {
      await boss.schedule(QUEUES.digest, `0 ${s.digestHourLocal} * * *`, {}, { tz, singletonKey: 'digest' })
      parts.push(`digest ${s.digestHourLocal}:00 ${tz}`)
    } else {
      await boss.unschedule(QUEUES.digest)
      parts.push('digest off')
    }
  }

  // Browser apply agent: batch tick and the daily portal status check.
  if (runsApplySide(role)) {
    if (s.portal.enabled) {
      await boss.schedule(QUEUES.portalBatch, '* * * * *', {}, { tz: 'UTC', singletonKey: 'portal-batch' })
      await boss.schedule(QUEUES.portalStatus, '0 10 * * *', {}, { tz, singletonKey: 'portal-status' })
      parts.push('browser batch every minute, portal status 10:00')
    } else {
      await boss.unschedule(QUEUES.portalBatch)
      await boss.unschedule(QUEUES.portalStatus)
      parts.push('browser apply off')
    }
  }
  return parts.join('; ')
}
