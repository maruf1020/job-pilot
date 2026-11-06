import { sameCompanyKey } from '@/lib/companies/same-company'
import { db } from '@/lib/db'
import type { EmailConfig } from '@/lib/settings/schema'

/**
 * Company cooldown: at most one application to a company (in one country, by default)
 * within `companyCooldownDays`. Counts applications already sent in the window and
 * applications waiting to go out (approved or queued). Enforced when drafting is planned,
 * when a draft is queued, when the dispatcher sends, and on "Send now".
 */

export interface CooldownConflict {
  applicationId: string
  jobTitle: string
  status: string
  sentAt: Date | null
  /** The earlier application went to the same mailbox (rather than the same company/location). */
  sameAddress: boolean
  /** The same job at the same company was applied to before: never again, whatever the date. */
  sameJob?: boolean
  toEmail: string | null
  /** When the company becomes available again (null while the other one is still waiting to be sent). */
  availableAt: Date | null
}

export interface CooldownTarget {
  companyId: string
  countryCode: string | null
  /** The application being checked, so it never conflicts with itself. */
  excludeApplicationId?: string
  /** Recipient address: one application per mailbox per window too, whatever the company (shared HR mailboxes, agencies). */
  toEmail?: string | null
}

/** A job title for comparing postings ("Senior Software Engineer (Full-stack)" = "senior software engineer full stack"). */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** The company and every other record of it under another spelling ("CHAOS Industries", "Chaosindustries"). */
export async function sameCompanyIds(companyId: string): Promise<string[]> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { name: true } })
  const key = company ? sameCompanyKey(company.name) : ''
  if (key.length < 3) return [companyId]
  const near = await db.company.findMany({ where: { name: { contains: key.slice(0, 5), mode: 'insensitive' } }, select: { id: true, name: true }, take: 200 })
  return [...new Set([companyId, ...near.filter((c) => sameCompanyKey(c.name) === key).map((c) => c.id)])]
}

/**
 * The most important rule: never the same job twice, at any time, and no override skips it.
 * The same posting came in from two sources and went out twice 15-20 days apart (Kpler, Ripple, Catapult,
 * Grafana Labs). `companyIds` defaults to the application's company under every spelling.
 */
export async function findSameJob(applicationId: string, companyIds?: string[]): Promise<CooldownConflict | null> {
  const self = await db.application.findUnique({ where: { id: applicationId }, select: { job: { select: { title: true, companyId: true } } } })
  const title = self ? titleKey(self.job.title) : ''
  if (!self || !title) return null
  const ids = companyIds ?? (await sameCompanyIds(self.job.companyId))
  const before = await db.application.findMany({
    where: { id: { not: applicationId }, sentAt: { not: null }, job: { companyId: { in: ids } } },
    select: { id: true, status: true, sentAt: true, toEmail: true, job: { select: { title: true } } },
    orderBy: { sentAt: 'desc' },
  })
  const same = before.find((b) => titleKey(b.job.title) === title)
  return same ? { applicationId: same.id, jobTitle: same.job.title, status: same.status, sentAt: same.sentAt, sameAddress: false, sameJob: true, toEmail: same.toEmail, availableAt: null } : null
}

export async function findCooldownConflict(target: CooldownTarget, email: Pick<EmailConfig, 'companyCooldownDays' | 'companyCooldownScope'>): Promise<CooldownConflict | null> {
  const days = email.companyCooldownDays
  if (days <= 0) return null
  const since = new Date(Date.now() - days * 86_400_000)
  const perCountry = email.companyCooldownScope === 'company_country' && Boolean(target.countryCode)
  const companyIds = await sameCompanyIds(target.companyId)
  if (target.excludeApplicationId) {
    const same = await findSameJob(target.excludeApplicationId, companyIds)
    if (same) return same
  }
  const hit = await db.application.findFirst({
    where: {
      ...(target.excludeApplicationId ? { id: { not: target.excludeApplicationId } } : {}),
      AND: [
        { OR: [{ sentAt: { gte: since } }, { status: { in: ['QUEUED', 'APPROVED'] } }] },
        {
          OR: [
            { job: { companyId: { in: companyIds }, ...(perCountry ? { countryCode: target.countryCode } : {}) } },
            ...(target.toEmail ? [{ toEmail: { equals: target.toEmail.trim(), mode: 'insensitive' as const } }] : []),
          ],
        },
      ],
    },
    orderBy: [{ sentAt: 'desc' }, { lastActivityAt: 'desc' }],
    select: { id: true, status: true, sentAt: true, toEmail: true, job: { select: { title: true, companyId: true, countryCode: true } } },
  })
  if (!hit) return null
  const sameCompany = companyIds.includes(hit.job.companyId) && (!perCountry || hit.job.countryCode === target.countryCode)
  return {
    applicationId: hit.id,
    jobTitle: hit.job.title,
    status: hit.status,
    sentAt: hit.sentAt,
    sameAddress: !sameCompany,
    toEmail: hit.toEmail,
    availableAt: hit.sentAt ? new Date(hit.sentAt.getTime() + days * 86_400_000) : null,
  }
}

export function describeConflict(companyName: string, countryCode: string | null, c: CooldownConflict, email: Pick<EmailConfig, 'companyCooldownDays' | 'companyCooldownScope'>): string {
  const where = email.companyCooldownScope === 'company_country' && countryCode ? ` in ${countryCode}` : ''
  if (c.sameJob) return `Already applied to this job at ${companyName} ("${c.jobTitle}") on ${c.sentAt?.toISOString().slice(0, 10)}; the same job is never applied to twice`
  if (c.sameAddress) {
    const target = c.toEmail ?? 'this address'
    if (!c.sentAt) return `Another application to ${target} ("${c.jobTitle}") is already waiting to be sent; only one per mailbox per ${email.companyCooldownDays} days`
    return `Already sent an application to ${target} ("${c.jobTitle}") on ${c.sentAt.toISOString().slice(0, 10)}; next one possible from ${c.availableAt!.toISOString().slice(0, 10)}`
  }
  if (!c.sentAt) return `Another application to ${companyName}${where} ("${c.jobTitle}") is already waiting to be sent; only one per ${email.companyCooldownDays} days`
  return `Already applied to ${companyName}${where} ("${c.jobTitle}") on ${c.sentAt.toISOString().slice(0, 10)}; next application possible from ${c.availableAt!.toISOString().slice(0, 10)}`
}

/** Warning text when applying to this company (and location) now would break the cooldown, else null. */
export async function cooldownWarning(target: CooldownTarget & { companyName: string }): Promise<{ message: string; conflictApplicationId: string } | null> {
  const { getSettings } = await import('@/lib/settings/service')
  const settings = await getSettings()
  const c = await findCooldownConflict(target, settings.email)
  if (!c) return null
  return { message: describeConflict(target.companyName, target.countryCode, c, settings.email), conflictApplicationId: c.applicationId }
}
