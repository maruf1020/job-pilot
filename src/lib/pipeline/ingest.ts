import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { isUsableContact } from '@/lib/email/address'
import { registeredSponsor } from '@/lib/sponsors/registers'
import { normalizeCompany } from '@/lib/text'
import type { NormalizedJob } from '@/lib/sources/types'
import { buildDedupeKey } from './dedupe'

export type IngestOutcome = 'created' | 'updated' | 'blacklisted'

async function resolveCompanyId(nj: NormalizedJob): Promise<{ id: string; blacklisted: boolean }> {
  if (nj.companyId) {
    const c = await db.company.findUnique({ where: { id: nj.companyId }, select: { id: true, blacklisted: true } })
    if (c) return c
  }
  const name = nj.company.trim() || 'Unknown company'
  const normalizedName = normalizeCompany(name) || name.toLowerCase()
  const existing = await db.company.findUnique({ where: { normalizedName }, select: { id: true, blacklisted: true } })
  if (existing) return existing
  try {
    // A company on an official sponsor register starts life as a known sponsor.
    const sponsor = await registeredSponsor(normalizedName).catch(() => null)
    const created = await db.company.create({
      data: { name, normalizedName, countryCode: nj.countryCode ?? null, knownSponsor: Boolean(sponsor), notes: sponsor ? `Sponsor register (${sponsor.country}): ${sponsor.source}${sponsor.permits ? `, ${sponsor.permits} permits` : ''}` : null },
      select: { id: true, blacklisted: true },
    })
    return created
  } catch (err) {
    // race on unique(normalizedName)
    const again = await db.company.findUnique({ where: { normalizedName }, select: { id: true, blacklisted: true } })
    if (again) return again
    throw err
  }
}

/**
 * Upsert one normalized job: company → Job (by dedupeKey) → JobSourceLink (by source+externalId).
 * Returns whether the job was new. Sources run side by side, so two of them can insert the same
 * company, job or link at once: a unique-key conflict (P2002) is retried once, and the second pass
 * finds the other insert and updates it instead.
 */
export async function ingestNormalizedJob(nj: NormalizedJob): Promise<{ outcome: IngestOutcome; jobId?: string }> {
  try {
    return await ingestOnce(nj)
  } catch (err) {
    if (!isUniqueConflict(err)) throw err
    return ingestOnce(nj)
  }
}

export function isUniqueConflict(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002'
}

async function ingestOnce(nj: NormalizedJob): Promise<{ outcome: IngestOutcome; jobId?: string }> {
  const company = await resolveCompanyId(nj)
  if (company.blacklisted) return { outcome: 'blacklisted' }

  const dedupeKey = buildDedupeKey(nj.company, nj.title, nj.countryCode)
  const now = new Date()
  const raw = nj.raw === undefined ? undefined : (nj.raw as Prisma.InputJsonValue)

  const jobSelect = { id: true, description: true, salaryMin: true, visaFlag: true, contactEmail: true, countryCode: true, postedAt: true } as const
  // The source's own id wins: a posting whose title or company spelling changed (trailing space,
  // "Ltd" added) keeps its job instead of failing on the unique (source, externalId) link.
  const linked = await db.jobSourceLink.findUnique({ where: { source_externalId: { source: nj.source, externalId: nj.externalId } }, select: { job: { select: jobSelect } } })
  const existing = linked?.job ?? (await db.job.findUnique({ where: { dedupeKey }, select: jobSelect }))
  if (existing) {
    await db.job.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: now,
        ...(nj.description.length > existing.description.length + 200 ? { description: nj.description } : {}),
        ...(existing.salaryMin == null && nj.salaryMin != null ? { salaryMin: Math.round(nj.salaryMin), salaryMax: nj.salaryMax != null ? Math.round(nj.salaryMax) : null, currency: nj.currency ?? null } : {}),
        ...(existing.visaFlag == null && nj.visaSponsorship != null ? { visaFlag: nj.visaSponsorship } : {}),
        ...(existing.contactEmail == null && nj.contactEmail && isUsableContact(nj.contactEmail) ? { contactEmail: nj.contactEmail } : {}),
        ...(existing.countryCode == null && nj.countryCode ? { countryCode: nj.countryCode } : {}),
        ...(existing.postedAt == null && nj.postedAt ? { postedAt: nj.postedAt } : {}),
      },
    })
    await db.jobSourceLink.upsert({
      where: { source_externalId: { source: nj.source, externalId: nj.externalId } },
      update: { lastSeenAt: now, url: nj.url, jobId: existing.id },
      create: { jobId: existing.id, source: nj.source, externalId: nj.externalId, url: nj.url, raw },
    })
    return { outcome: 'updated', jobId: existing.id }
  }

  try {
    const created = await db.job.create({
      data: {
        dedupeKey,
        title: nj.title.trim().slice(0, 300),
        companyId: company.id,
        companyName: nj.company.trim().slice(0, 200) || 'Unknown company',
        url: nj.url,
        location: nj.location?.slice(0, 200) ?? null,
        countryCode: nj.countryCode ?? null,
        remote: Boolean(nj.remote),
        description: nj.description,
        salaryMin: nj.salaryMin != null ? Math.round(nj.salaryMin) : null,
        salaryMax: nj.salaryMax != null ? Math.round(nj.salaryMax) : null,
        currency: nj.currency ?? null,
        postedAt: nj.postedAt ?? null,
        primarySource: nj.source,
        tags: nj.tags.slice(0, 20),
        visaFlag: nj.visaSponsorship ?? null,
        contactEmail: nj.contactEmail && isUsableContact(nj.contactEmail) ? nj.contactEmail : null,
        firstSeenAt: now,
        lastSeenAt: now,
        sourceLinks: { create: { source: nj.source, externalId: nj.externalId, url: nj.url, raw } },
      },
      select: { id: true },
    })
    return { outcome: 'created', jobId: created.id }
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === 'P2002') {
      // Lost a race on dedupeKey or the source link; treat as an update.
      const again = await db.job.findUnique({ where: { dedupeKey }, select: { id: true } })
      if (again) {
        await db.jobSourceLink
          .upsert({
            where: { source_externalId: { source: nj.source, externalId: nj.externalId } },
            update: { lastSeenAt: now, jobId: again.id },
            create: { jobId: again.id, source: nj.source, externalId: nj.externalId, url: nj.url, raw },
          })
          .catch(() => undefined)
        return { outcome: 'updated', jobId: again.id }
      }
    }
    throw err
  }
}
