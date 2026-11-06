import { db } from '@/lib/db'

/**
 * A company's hiring process (Skill Test → AI interview → ... → Offer) and what happened at each step
 * (an assessment review, interview notes), kept as application events so no schema change is needed:
 * type "process" holds the latest stage list in meta, type "prep" one saved write-up.
 */
export type StageStatus = 'done' | 'current' | 'todo'
export interface HiringStage {
  name: string
  status: StageStatus
  /** When it was done, or when it is booked (ISO). */
  at?: string | null
  note?: string | null
}
export interface PrepNote {
  id: string
  title: string
  body: string
  createdAt: string
}
export interface HiringInfo {
  stages: HiringStage[]
  updatedAt: string | null
  preps: PrepNote[]
}

const asStages = (meta: unknown): HiringStage[] => {
  const stages = (meta as { stages?: unknown } | null)?.stages
  return Array.isArray(stages) ? (stages as HiringStage[]).filter((s) => s && typeof s.name === 'string') : []
}

export async function loadHiring(applicationId: string): Promise<HiringInfo> {
  const [process, preps] = await Promise.all([
    db.applicationEvent.findFirst({ where: { applicationId, type: 'process' }, orderBy: { createdAt: 'desc' } }),
    db.applicationEvent.findMany({ where: { applicationId, type: 'prep' }, orderBy: { createdAt: 'desc' } }),
  ])
  return {
    stages: asStages(process?.meta),
    updatedAt: process?.createdAt.toISOString() ?? null,
    preps: preps.map((p) => {
      const m = (p.meta ?? {}) as { title?: string; body?: string }
      return { id: p.id, title: m.title ?? p.message, body: m.body ?? '', createdAt: p.createdAt.toISOString() }
    }),
  }
}

/** Saves the stage list; the message says what changed so the Activity list reads well. */
export async function saveHiringStages(applicationId: string, stages: HiringStage[], message: string) {
  return db.applicationEvent.create({ data: { applicationId, type: 'process', message, meta: { stages } as object } })
}

export async function savePrep(applicationId: string, title: string, body: string) {
  return db.applicationEvent.create({ data: { applicationId, type: 'prep', message: `Saved for later: ${title}`, meta: { title, body } as object } })
}

export interface ActiveProcess {
  applicationId: string
  company: string
  title: string
  countryCode: string | null
  current: HiringStage | null
  next: HiringStage | null
  done: number
  total: number
  updatedAt: string
}

/** Every application with a hiring process still under way (not every stage done, not rejected), newest change first. */
export async function activeProcesses(): Promise<ActiveProcess[]> {
  const events = await db.applicationEvent.findMany({
    where: { type: 'process', application: { status: { notIn: ['REJECTED', 'SKIPPED'] } } },
    orderBy: { createdAt: 'desc' },
    select: { applicationId: true, meta: true, createdAt: true, application: { select: { job: { select: { companyName: true, title: true, countryCode: true } } } } },
  })
  const seen = new Set<string>()
  const out: ActiveProcess[] = []
  for (const e of events) {
    if (seen.has(e.applicationId)) continue
    seen.add(e.applicationId)
    const stages = asStages(e.meta)
    const current = stages.find((s) => s.status === 'current') ?? stages.find((s) => s.status === 'todo') ?? null
    if (!current) continue
    const i = stages.indexOf(current)
    out.push({
      applicationId: e.applicationId,
      company: e.application.job.companyName,
      title: e.application.job.title,
      countryCode: e.application.job.countryCode,
      current,
      next: stages.slice(i + 1).find((s) => s.status !== 'done') ?? null,
      done: stages.filter((s) => s.status === 'done').length,
      total: stages.length,
      updatedAt: e.createdAt.toISOString(),
    })
  }
  return out
}
