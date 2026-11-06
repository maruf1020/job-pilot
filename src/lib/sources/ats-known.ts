import { db } from '@/lib/db'

/**
 * The ATS postings already in the database, so a board run ingests only new ones. The map is
 * externalId ("type:slug:id") -> jobId; a run reads it once.
 */
export async function loadKnownAtsPostings(): Promise<Map<string, string>> {
  const rows = await db.jobSourceLink.findMany({ where: { source: 'ats' }, select: { externalId: true, jobId: true } })
  return new Map(rows.map((r) => [r.externalId, r.jobId]))
}

/** Postings a board still lists: refresh "last seen" on the links and their jobs (two queries per board). */
export async function touchKnownAtsPostings(externalIds: string[], jobIds: string[]): Promise<void> {
  if (!externalIds.length) return
  const now = new Date()
  await db.jobSourceLink.updateMany({ where: { source: 'ats', externalId: { in: externalIds } }, data: { lastSeenAt: now } })
  if (jobIds.length) await db.job.updateMany({ where: { id: { in: [...new Set(jobIds)] } }, data: { lastSeenAt: now } })
}
