import { z } from 'zod'
import { badRequest, HttpError, notFound, ok, readJson, route } from '@/lib/api/response'
import { cooldownWarning } from '@/lib/pipeline/cooldown'
import { db } from '@/lib/db'
import { discoverContactForJob } from '@/lib/pipeline/contacts'
import { webContactOptions } from '@/lib/runtime'
import { enqueueDraft } from '@/lib/queue'

const schema = z.object({
  action: z.enum(['draft', 'skip', 'unskip', 'mark-applied', 'blacklist-company', 'rescore', 'find-contact']),
  note: z.string().max(2000).optional(),
  ignoreCooldown: z.boolean().optional(),
})

/** POST /api/jobs/:id/actions  { action } */
export const POST = route(async (req, { params }) => {
  const { id } = await params
  const { action, note, ignoreCooldown } = await readJson(req, schema)
  const job = await db.job.findUnique({ where: { id }, include: { application: true } })
  if (!job) throw notFound('Job')

  switch (action) {
    case 'draft': {
      if (job.application && ['SENT', 'REPLIED', 'INTERVIEW', 'OFFER'].includes(job.application.status)) throw badRequest('Already applied')
      const queued = await enqueueDraft({ jobId: id, note: note ?? null, force: true })
      await db.job.update({ where: { id }, data: { status: 'DRAFTING' } })
      return ok({ queued: Boolean(queued) }, { message: 'Draft queued' })
    }
    case 'skip':
      await db.job.update({ where: { id }, data: { status: 'SKIPPED' } })
      if (job.application && !job.application.sentAt) await db.application.update({ where: { id: job.application.id }, data: { status: 'SKIPPED' } })
      return ok({ status: 'SKIPPED' })
    case 'unskip':
      await db.job.update({ where: { id }, data: { status: job.enrichedAt ? 'RANKED' : 'NEW', filterReason: null } })
      return ok({ status: 'RANKED' })
    case 'mark-applied': {
      const warning = await cooldownWarning({ companyId: job.companyId, countryCode: job.countryCode, companyName: job.companyName, excludeApplicationId: job.application?.id, toEmail: job.contactEmail })
      if (warning && !ignoreCooldown) throw new HttpError(409, warning.message, { code: 'cooldown', conflictApplicationId: warning.conflictApplicationId })
      const app = await db.application.upsert({
        where: { jobId: id },
        update: { status: 'SENT', sentAt: new Date(), lastActivityAt: new Date(), notes: note ?? undefined },
        create: { jobId: id, channel: job.applyChannel === 'unknown' ? 'portal' : job.applyChannel, status: 'SENT', sentAt: new Date(), notes: note ?? null },
      })
      await db.job.update({ where: { id }, data: { status: 'APPLIED' } })
      return ok(app, { message: 'Marked as applied' })
    }
    case 'blacklist-company':
      await db.company.update({ where: { id: job.companyId }, data: { blacklisted: true } })
      await db.job.updateMany({ where: { companyId: job.companyId, status: { in: ['NEW', 'RANKED', 'REVIEW', 'DRAFTING'] } }, data: { status: 'SKIPPED' } })
      return ok({ blacklisted: true })
    case 'rescore':
      await db.job.update({ where: { id }, data: { status: 'NEW', enrichedAt: null, filterReason: null } })
      return ok({ status: 'NEW' }, { message: 'Will be re-enriched and re-ranked on the next run' })
    case 'find-contact': {
      // Re-check even if a previous lookup found nothing.
      await db.job.update({ where: { id }, data: { contactCheckedAt: null } })
      const web = webContactOptions()
      const r = await discoverContactForJob(id, web)
      const how: Record<string, string> = {
        verified: 'mailbox confirmed by the company mail server',
        website: 'found on the company website',
        search: 'found by web search',
        guessed: 'guessed from the company domain (not verified)',
        posting: 'from the posting',
        company: 'from the company record',
        manual: 'entered by hand',
      }
      return ok(r, {
        message: r.email
          ? `${r.email} — ${how[r.source ?? ''] ?? r.source}${web.skipVerify && r.source !== 'verified' ? ' · mailbox verification happens in the worker batch' : ''}`
          : `No address found${r.domain ? ` for ${r.domain}` : ' (company domain unknown; set it on the company)'}${r.notes.length ? `. ${r.notes[r.notes.length - 1]}` : ''}`,
      })
    }
  }
})
