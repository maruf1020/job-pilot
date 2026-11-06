import { getAiUsageSummary } from '@/lib/ai/usage'
import { db } from '@/lib/db'
import { countLessons } from '@/lib/apply/lessons'
import { getSettings } from '@/lib/settings/service'
import { lastDays, localDay, shiftDay, startOfLocalDay, topWithOther } from './stats'

/**
 * What the AI does for the owner (Stats > AI): calls per day by task, today's quota across every key, how
 * the screenshot form driver did, why forms stopped (the AI's own reading of the screenshot), and what it has learned.
 */

const DAYS = 14

export interface PlaybookCounts {
  lessons: number
  lessons7d: number
  fixHints: number
  diagnoses7d: number
  siteKinds: number
}

/** Count the lessons (from forms that went through) and diagnoses (from forms that stopped) in the playbook. */
export function countPlaybook(lines: string[], now = Date.now()): PlaybookCounts {
  const weekAgo = now - 7 * 86_400_000
  const kinds = new Set<string>()
  const out: PlaybookCounts = { lessons: 0, lessons7d: 0, fixHints: 0, diagnoses7d: 0, siteKinds: 0 }
  for (const line of lines) {
    if (!line.trim()) continue
    let row: { at?: string; kind?: string; outcome?: string; lesson?: string; fixHint?: string | null }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const at = row.at ? Date.parse(row.at) : 0
    if (row.kind) kinds.add(row.kind)
    if (row.outcome === 'diagnosis') {
      if (row.fixHint) out.fixHints++
      if (at >= weekAgo) out.diagnoses7d++
    } else if (row.lesson) {
      out.lessons++
      if (at >= weekAgo) out.lessons7d++
    }
  }
  out.siteKinds = kinds.size
  return out
}

export async function loadGeminiStats(now = new Date()) {
  const settings = await getSettings()
  const tz = settings.timezone || 'UTC'
  const today = localDay(now, tz)
  const since = startOfLocalDay(shiftDay(today, -(DAYS - 1)), tz)
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)

  const [perDayRows, quota, driverRows, diagnosed, recent] = await Promise.all([
    db.$queryRaw<Array<{ day: string; task: string; calls: number; errors: number }>>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, task,
             COUNT(*)::int AS calls, (COUNT(*) FILTER (WHERE NOT ok))::int AS errors
      FROM "AiUsage" WHERE "createdAt" >= ${since} GROUP BY 1, 2`,
    getAiUsageSummary(),
    // Attempts where the screenshot driver took over, by how they ended.
    db.$queryRaw<Array<{ status: string; n: number }>>`
      SELECT status, COUNT(*)::int AS n FROM "PortalAttempt"
      WHERE "startedAt" >= ${weekAgo} AND (steps::text LIKE '%Gemini takes over%' OR steps::text LIKE '%AI takes over%') GROUP BY 1`,
    db.$queryRaw<Array<{ category: string; n: number }>>`
      SELECT diagnosis->>'category' AS category, COUNT(*)::int AS n FROM "PortalAttempt"
      WHERE "startedAt" >= ${weekAgo} AND diagnosis IS NOT NULL GROUP BY 1`,
    db.portalAttempt.findMany({
      where: { diagnosis: { not: { equals: null } }, startedAt: { gte: weekAgo } },
      orderBy: { finishedAt: 'desc' },
      take: 8,
      select: { id: true, applicationId: true, diagnosis: true, finishedAt: true, application: { select: { job: { select: { title: true, companyName: true } } } } },
    }),
  ])

  // Calls per day: the three busiest tasks of the fortnight, the rest as "other" (no fifth colour).
  const byTask = new Map<string, number>()
  for (const r of perDayRows) byTask.set(r.task, (byTask.get(r.task) ?? 0) + Number(r.calls))
  const top = [...byTask.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t)
  const days = lastDays(DAYS, today).map((day) => ({ day, total: 0, errors: 0, other: 0, ...Object.fromEntries(top.map((t) => [t, 0])) }) as Record<string, number | string> & { day: string; total: number; errors: number; other: number })
  const index = new Map(days.map((d) => [d.day, d]))
  for (const r of perDayRows) {
    const d = index.get(r.day)
    if (!d) continue
    const key = top.includes(r.task) ? r.task : 'other'
    d[key] = Number(d[key] ?? 0) + Number(r.calls)
    d.total += Number(r.calls)
    d.errors += Number(r.errors)
  }

  let playbook: PlaybookCounts = { lessons: 0, lessons7d: 0, fixHints: 0, diagnoses7d: 0, siteKinds: 0 }
  try {
    // Site lessons live in the SiteLesson table (src/lib/apply/lessons.ts).
    playbook = await countLessons(now.getTime())
  } catch {
    // No lessons yet.
  }

  const driver = { runs: 0, submitted: 0, needsYou: 0, failed: 0 }
  for (const r of driverRows) {
    const n = Number(r.n)
    driver.runs += n
    if (r.status === 'SUBMITTED') driver.submitted += n
    else if (r.status === 'NEEDS_HUMAN' || r.status === 'AWAITING_REVIEW') driver.needsYou += n
    else if (r.status === 'FAILED') driver.failed += n
  }

  return {
    timezone: tz,
    tasks: top,
    perDay: days,
    today: {
      calls: quota.totalCalls,
      errors: quota.totalErrors,
      tokens: quota.inputTokens + quota.outputTokens,
      remaining: quota.remainingDaily,
      keys: quota.keys.filter((k) => k.enabled).length,
      provider: quota.provider,
      byTask: [...quota.byTask].sort((a, b) => b.calls - a.calls),
    },
    driver,
    stopped: topWithOther(
      diagnosed.map((r) => ({ key: r.category ?? 'other', count: Number(r.n) })),
      8,
      { key: 'other' },
    ),
    recent: recent.map((r) => ({
      attemptId: r.id,
      applicationId: r.applicationId,
      company: r.application.job.companyName,
      title: r.application.job.title,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      diagnosis: r.diagnosis,
    })),
    playbook,
  }
}

export type GeminiStats = Awaited<ReturnType<typeof loadGeminiStats>>
