import { z } from 'zod'
import { badRequest, HttpError, notFound, ok, readJson, route } from '@/lib/api/response'
import { cooldownWarning } from '@/lib/pipeline/cooldown'
import { db } from '@/lib/db'
import { draftReply, markHandled, sendReply } from '@/lib/email/reply'
import { CooldownError, sendApplication } from '@/lib/email/send'
import { lintEmail } from '@/lib/pipeline/humanize/lint'
import { getBannedPhrases } from '@/lib/pipeline/humanize/phrases'
import { evaluateAutoSend } from '@/lib/pipeline/decide'
import { getProfile } from '@/lib/pipeline/profile'
import { enqueueDraft } from '@/lib/queue'
import { getSettings } from '@/lib/settings/service'

const schema = z.object({
  action: z.enum(['approve', 'send-now', 'unqueue', 'skip', 'regenerate', 'mark-applied', 'select-draft', 'save-draft', 'lint', 'draft-reply', 'send-reply', 'mark-handled']),
  note: z.string().max(2000).optional(),
  draftId: z.string().optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(10000).optional(),
  /** You saw the "already applied to this company" warning and chose to go ahead. */
  ignoreCooldown: z.boolean().optional(),
  // Replies to recruiters (draft-reply / send-reply / mark-handled)
  to: z.string().max(200).optional(),
  cc: z.string().max(500).nullable().optional(),
  attachResume: z.boolean().optional(),
  /** What the reply should say, in your words (optional guidance for the draft). */
  instruction: z.string().max(1000).nullable().optional(),
  /** The inbound message being answered or marked. */
  messageId: z.string().nullable().optional(),
  handled: z.boolean().optional(),
  /** Draft a nudge after my own last message instead of an answer to theirs. */
  nudge: z.boolean().optional(),
})

/** POST /api/applications/:id/actions */
export const POST = route(async (req, { params }) => {
  const { id } = await params
  const input = await readJson(req, schema)
  const app = await db.application.findUnique({ where: { id }, include: { job: { select: { id: true, companyName: true, mustHaveSkills: true, companyId: true, countryCode: true } } } })
  if (!app) throw notFound('Application')

  // Manual applying: warn when the company (and location) was applied to within the cooldown.
  if (['approve', 'send-now', 'mark-applied'].includes(input.action) && !app.sentAt) {
    const warning = await cooldownWarning({ companyId: app.job.companyId, countryCode: app.job.countryCode, companyName: app.job.companyName, excludeApplicationId: app.id, toEmail: app.toEmail })
    if (warning && !input.ignoreCooldown && !app.cooldownOverride) throw new HttpError(409, warning.message, { code: 'cooldown', conflictApplicationId: warning.conflictApplicationId })
    if (warning && input.ignoreCooldown) await db.application.update({ where: { id }, data: { cooldownOverride: true, notes: `Applied despite the company cooldown (your choice): ${warning.message}`.slice(0, 1000) } })
  }

  switch (input.action) {
    case 'approve': {
      if (app.channel !== 'email') throw badRequest('Only email applications can be queued')
      const r = await evaluateAutoSend(id, { force: true, ignoreCooldown: input.ignoreCooldown })
      if (r.outcome !== 'queued') throw badRequest(r.reason ?? 'Could not queue')
      const paused = !(await getSettings()).email.sendingEnabled
      return ok({ scheduledFor: r.scheduledFor, paused }, { message: paused ? `Queued for ${r.scheduledFor?.toISOString()}. Sending is paused: it waits until you allow sending in Settings → Email` : `Queued for ${r.scheduledFor?.toISOString()}` })
    }
    case 'send-now': {
      const r = await sendApplication(id, { force: true, draftId: input.draftId, ignoreCooldown: input.ignoreCooldown }).catch((err: unknown) => {
        if (err instanceof CooldownError) throw badRequest(err.message)
        throw err
      })
      return ok(r, { message: 'Sent' })
    }
    case 'unqueue':
      await db.application.update({ where: { id }, data: { status: 'REVIEW', scheduledFor: null, lastActivityAt: new Date() } })
      return ok({ status: 'REVIEW' })
    case 'skip':
      await db.application.update({ where: { id }, data: { status: 'SKIPPED', scheduledFor: null, lastActivityAt: new Date() } })
      await db.job.update({ where: { id: app.job.id }, data: { status: 'SKIPPED' } })
      return ok({ status: 'SKIPPED' })
    case 'regenerate': {
      await enqueueDraft({ jobId: app.job.id, note: input.note ?? null, force: true })
      await db.application.update({ where: { id }, data: { status: 'DRAFT', lastActivityAt: new Date() } })
      return ok({ queued: true }, { message: 'Regeneration queued' })
    }
    case 'mark-applied':
      await db.application.update({ where: { id }, data: { status: 'SENT', sentAt: app.sentAt ?? new Date(), lastActivityAt: new Date(), notes: input.note ?? app.notes } })
      await db.job.update({ where: { id: app.job.id }, data: { status: 'APPLIED' } })
      return ok({ status: 'SENT' })
    case 'draft-reply': {
      const r = await draftReply(id, { messageId: input.messageId ?? null, instruction: input.instruction ?? null, nudge: input.nudge })
      return ok(r, { message: r.missing.length ? `Draft ready. Fill in: ${r.missing.join(', ')}` : 'Draft ready' })
    }
    case 'send-reply': {
      // Your click is the permission: this sends even while automatic sending is paused.
      if (!input.to || !input.subject || !input.body) throw badRequest('Recipient, subject and body are required')
      const r = await sendReply(id, { to: input.to, cc: input.cc ?? null, subject: input.subject, body: input.body, attachResume: input.attachResume, replyToMessageId: input.messageId ?? null })
      return ok(r, { message: `Reply sent to ${r.to}` })
    }
    case 'mark-handled': {
      const n = await markHandled(input.messageId ? { messageId: input.messageId } : { applicationId: id }, input.handled ?? true)
      return ok({ handled: n }, { message: input.handled === false ? 'Reopened' : 'Marked as handled' })
    }
    case 'select-draft': {
      if (!input.draftId) throw badRequest('draftId required')
      const d = await db.emailDraft.findUnique({ where: { id: input.draftId } })
      if (!d || d.applicationId !== id) throw notFound('Draft')
      await db.emailDraft.updateMany({ where: { applicationId: id, kind: d.kind }, data: { isSelected: false } })
      await db.emailDraft.update({ where: { id: d.id }, data: { isSelected: true } })
      return ok({ selected: d.id })
    }
    case 'lint':
    case 'save-draft': {
      if (!input.subject || !input.body) throw badRequest('subject and body required')
      const profile = await getProfile()
      const lint = lintEmail(input.subject, input.body, {
        companyName: app.job.companyName,
        mustHaveSkills: app.job.mustHaveSkills,
        profileFacts: profile?.facts ?? [],
        profileName: profile?.fullName ?? '',
        stopSkills: profile?.stopSkills ?? [],
        bannedPhrases: await getBannedPhrases(),
        kind: 'initial',
      })
      if (input.action === 'lint') return ok(lint)
      const last = await db.emailDraft.findFirst({ where: { applicationId: id, kind: 'initial' }, orderBy: { version: 'desc' } })
      await db.emailDraft.updateMany({ where: { applicationId: id, kind: 'initial' }, data: { isSelected: false } })
      const draft = await db.emailDraft.create({
        data: {
          applicationId: id,
          kind: 'initial',
          version: (last?.version ?? 0) + 1,
          subject: lint.fixedSubject,
          body: lint.fixedBody,
          lintResult: { passed: lint.passed, errors: lint.errors, warnings: lint.warnings, stats: lint.stats } as object,
          passed: lint.passed,
          isSelected: true,
          generatedBy: 'human',
        },
      })
      const status = app.status === 'NEEDS_HUMAN' || app.status === 'DRAFT' ? (lint.passed ? 'REVIEW' : 'NEEDS_HUMAN') : app.status
      await db.application.update({ where: { id }, data: { status, lastActivityAt: new Date() } })
      return ok({ draft, lint })
    }
  }
})
