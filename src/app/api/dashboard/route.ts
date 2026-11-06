import { getAiUsageSummary } from '@/lib/ai/usage'
import { loadWeekFunnel } from '@/lib/analytics/week-funnel'
import { ok, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { dueFollowUps } from '@/lib/email/follow-ups'
import { needsAction } from '@/lib/email/needs-action'
import { getSettings } from '@/lib/settings/service'

interface DayRow {
  day: Date
  count: bigint | number
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

function seriesFrom(rows: DayRow[], days: number): Array<{ day: string; count: number }> {
  const map = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.count)]))
  const out: Array<{ day: string; count: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const key = daysAgo(i).toISOString().slice(0, 10)
    out.push({ day: key, count: map.get(key) ?? 0 })
  }
  return out
}

export const GET = route(async () => {
  const settings = await getSettings()
  const today = daysAgo(0)
  const week = daysAgo(7)
  const twoWeeks = daysAgo(14)
  const threshold = settings.ranking.draftThreshold

  const [
    foundToday,
    found7d,
    foundTotal,
    highScore7d,
    awaitingReview,
    queued,
    sentTotal,
    sent7d,
    replied,
    interviews,
    offers,
    rejected,
    foundByDay,
    sentByDay,
    byCountry,
    bySource,
    rankedAboveThreshold,
    drafted,
    needsReview,
    recentReplies,
    lastRuns,
    nextQueued,
    usage,
    topJobs,
    actionItems,
    followUps,
    formsWaiting,
  ] = await Promise.all([
    db.job.count({ where: { firstSeenAt: { gte: today } } }),
    db.job.count({ where: { firstSeenAt: { gte: week } } }),
    db.job.count(),
    db.job.count({ where: { firstSeenAt: { gte: week }, status: { in: ['RANKED', 'REVIEW', 'DRAFTING'] }, score: { finalScore: { gte: threshold } } } }),
    db.application.count({ where: { status: { in: ['REVIEW', 'NEEDS_HUMAN'] } } }),
    db.application.count({ where: { status: 'QUEUED' } }),
    db.application.count({ where: { sentAt: { not: null } } }),
    db.application.count({ where: { sentAt: { gte: week } } }),
    db.application.count({ where: { repliedAt: { not: null } } }),
    db.application.count({ where: { status: 'INTERVIEW' } }),
    db.application.count({ where: { status: 'OFFER' } }),
    db.application.count({ where: { status: 'REJECTED' } }),
    db.$queryRaw<DayRow[]>`SELECT date_trunc('day', "firstSeenAt") AS day, COUNT(*)::int AS count FROM "Job" WHERE "firstSeenAt" >= ${twoWeeks} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<DayRow[]>`SELECT date_trunc('day', "sentAt") AS day, COUNT(*)::int AS count FROM "Application" WHERE "sentAt" >= ${twoWeeks} GROUP BY 1 ORDER BY 1`,
    db.job.groupBy({ by: ['countryCode'], where: { status: { notIn: ['FILTERED', 'REJECTED_RULE'] } }, _count: { _all: true }, orderBy: { _count: { countryCode: 'desc' } }, take: 10 }),
    db.jobSourceLink.groupBy({ by: ['source'], _count: { _all: true }, orderBy: { _count: { source: 'desc' } } }),
    db.job.count({ where: { score: { finalScore: { gte: threshold } } } }),
    db.application.count(),
    db.application.findMany({
      where: { status: { in: ['REVIEW', 'NEEDS_HUMAN'] } },
      orderBy: { lastActivityAt: 'desc' },
      take: 8,
      select: { id: true, status: true, channel: true, lastActivityAt: true, job: { select: { title: true, companyName: true, countryCode: true, score: { select: { finalScore: true } } } } },
    }),
    db.emailMessage.findMany({
      where: { direction: 'INBOUND' },
      orderBy: { receivedAt: 'desc' },
      take: 6,
      select: { id: true, classification: true, subject: true, fromAddress: true, receivedAt: true, isRead: true, application: { select: { id: true, job: { select: { title: true, companyName: true } } } } },
    }),
    db.searchRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5, select: { id: true, status: true, trigger: true, startedAt: true, durationMs: true, totalFetched: true, totalNew: true, totalRanked: true, totalDrafted: true, errorCount: true } }),
    db.application.findMany({ where: { status: 'QUEUED' }, orderBy: { scheduledFor: 'asc' }, take: 5, select: { id: true, scheduledFor: true, job: { select: { title: true, companyName: true } } } }),
    getAiUsageSummary(),
    db.job.findMany({
      // Fresh first among the best: a 3-week-old posting is usually filled or flooded.
      where: { status: { in: ['RANKED', 'REVIEW'] }, application: null, firstSeenAt: { gte: twoWeeks } },
      orderBy: [{ finalScore: { sort: 'desc', nulls: 'last' } }, { firstSeenAt: 'desc' }],
      take: 8,
      select: { id: true, title: true, companyName: true, countryCode: true, sponsorship: true, applyChannel: true, firstSeenAt: true, score: { select: { finalScore: true } } },
    }),
    needsAction(),
    dueFollowUps().catch(() => []),
    // Forms the browser agent filled that wait for your Submit, one per application.
    db.portalAttempt.findMany({ where: { status: 'AWAITING_REVIEW', application: { sentAt: null } }, distinct: ['applicationId'], select: { applicationId: true } }),
  ])
  const oldestReplyDays = actionItems.needsYou.reduce((m, r) => Math.max(m, r.ageDays), 0)
  const weekFunnel = await loadWeekFunnel(threshold).catch(() => null)

  return ok({
    actions: {
      repliesWaiting: actionItems.needsYou.length,
      interviewRequests: actionItems.needsYou.filter((r) => r.classification === 'INTERVIEW_REQUEST').length,
      oldestReplyDays,
      quietThreads: actionItems.waitingForThem.length,
      formsReady: formsWaiting.length,
      followUpsDue: followUps.length,
      draftsToReview: awaitingReview,
      sendingEnabled: settings.email.sendingEnabled,
    },
    tiles: {
      foundToday,
      found7d,
      foundTotal,
      highScore7d,
      awaitingReview,
      queued,
      sentTotal,
      sent7d,
      replied,
      interviews,
      offers,
      rejected,
      replyRate: sentTotal ? Math.round((replied / sentTotal) * 100) : 0,
      quotaUsed: usage.totalCalls,
      quotaRemaining: usage.remainingDaily,
    },
    series: {
      found: seriesFrom(foundByDay, 14),
      sent: seriesFrom(sentByDay, 14),
    },
    byCountry: byCountry.map((r) => ({ country: r.countryCode ?? '??', count: r._count._all })),
    bySource: bySource.map((r) => ({ source: r.source, count: r._count._all })),
    funnel: [
      { stage: 'Found', count: foundTotal },
      { stage: `Score ≥ ${threshold}`, count: rankedAboveThreshold },
      { stage: 'Drafted', count: drafted },
      { stage: 'Sent', count: sentTotal },
      { stage: 'Replied', count: replied },
      { stage: 'Interview', count: interviews + offers },
    ],
    needsReview,
    recentReplies,
    lastRuns,
    nextQueued,
    topJobs,
    quota: usage,
    weekFunnel,
  })
})
