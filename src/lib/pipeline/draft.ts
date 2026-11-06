import type { Prisma } from '@/generated/prisma/client'
import { generateJson } from '@/lib/ai/gemini'
import { getAiUsageSummary } from '@/lib/ai/usage'
import { coverLetterPrompt, draftSystemPrompt, draftUserPrompt, PROMPT_VERSION, type JobForPrompt, type ProfileForPrompt } from '@/lib/ai/prompts'
import { coverLetterSchema, draftSchema } from '@/lib/ai/schemas'
import { db } from '@/lib/db'
import type { ApplyChannel } from '@/lib/domain'
import { notify } from '@/lib/notifications'
import type { AppSettings } from '@/lib/settings/schema'
import { getSettings } from '@/lib/settings/service'
import { preferredChannel } from './channel'
import { getBannedPhrases } from './humanize/phrases'
import { humanizeLoop, type DraftVersion } from './humanize/loop'
import { lintEmail } from './humanize/lint'
import type { RunLogger } from './logger'
import { getProfileForPrompt } from './profile'

const json = (v: unknown) => v as Prisma.InputJsonValue

export interface DraftOptions {
  note?: string | null
  /** Regenerate even if a passing draft exists. */
  force?: boolean
  log?: RunLogger
  /**
   * Fast mode (auto-apply): one draft plus the free deterministic checks, at most one
   * rewrite for check failures, no AI-writing judge. About 1-2 AI calls instead of up to 8.
   */
  fast?: boolean
}

/** Where the candidate saw a posting, as the reader would say it; ATS boards and aggregators of them are the company's own page. */
const FOUND_ON: Record<string, string> = {
  linkedin: 'LinkedIn',
  adzuna: 'Adzuna',
  jooble: 'Jooble',
  arbeitnow: 'Arbeitnow',
  arbeitnow_uk: 'Arbeitnow',
  eures: 'the EURES job portal',
  hn: 'Hacker News',
  themuse: 'The Muse',
  jobicy: 'Jobicy',
  himalayas: 'Himalayas',
  jobnet: 'Jobnet',
  jobindex: 'Jobindex',
  workingnomads: 'Working Nomads',
  remoteok: 'Remote OK',
  remotive: 'Remotive',
  landingjobs: 'Landing.jobs',
  reed: 'Reed',
  ats: 'your careers page',
  freehire: 'your careers page',
}

export function foundOn(primarySource: string | null | undefined): string | null {
  return primarySource ? (FOUND_ON[primarySource] ?? null) : null
}

export function toJobForPrompt(job: Prisma.JobGetPayload<{ include: { score: true } }>): JobForPrompt {
  return {
    id: job.id,
    title: job.title,
    company: job.companyName,
    location: job.location,
    countryCode: job.countryCode,
    url: job.url,
    description: job.description,
    summary: job.summary,
    mustHaveSkills: job.mustHaveSkills,
    sponsorship: job.sponsorship,
    sponsorshipEvidence: job.sponsorshipEvidence,
    hook: job.score?.hook ?? null,
    foundOn: foundOn(job.primarySource),
  }
}

export function resolveChannel(job: { contactEmail: string | null; applyChannel: string; atsType?: string | null }): ApplyChannel {
  return preferredChannel(job)
}

async function persistVersions(applicationId: string, kind: 'initial' | 'follow_up', versions: DraftVersion[], selectedIndex: number) {
  const last = await db.emailDraft.findFirst({ where: { applicationId, kind }, orderBy: { version: 'desc' }, select: { version: true } })
  let version = (last?.version ?? 0) + 1
  await db.emailDraft.updateMany({ where: { applicationId, kind, isSelected: true }, data: { isSelected: false } })
  const ids: string[] = []
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i]
    const row = await db.emailDraft.create({
      data: {
        applicationId,
        kind,
        version: version++,
        subject: v.subject,
        body: v.body,
        lintResult: json({ passed: v.lint.passed, errors: v.lint.errors, warnings: v.lint.warnings, stats: v.lint.stats }),
        judgeResult: v.judge ? json(v.judge) : undefined,
        externalAiScore: v.externalAiScore,
        passed: v.passed,
        isSelected: i === selectedIndex,
        generatedBy: v.generatedBy,
        promptVersion: PROMPT_VERSION,
        feedback: v.feedback,
      },
      select: { id: true },
    })
    ids.push(row.id)
  }
  return ids
}

/**
 * Create (or refresh) the Application for a job and produce the email draft or,
 * for ATS/portal jobs, the cover letter + answers block.
 */
export async function draftApplication(jobId: string, opts: DraftOptions = {}) {
  const settings = await getSettings()
  const profile = await getProfileForPrompt()
  const job = await db.job.findUnique({ where: { id: jobId }, include: { score: true, company: { select: { name: true, blacklisted: true } } } })
  if (!job) throw new Error('Job not found')
  if (job.company.blacklisted) throw new Error('Company is blacklisted')

  const channel = resolveChannel(job)
  const existing = await db.application.findUnique({ where: { jobId }, include: { drafts: { where: { isSelected: true }, take: 1 } } })
  if (existing && !opts.force && ['SENT', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'QUEUED', 'APPROVED'].includes(existing.status)) {
    return existing
  }

  const application =
    existing ??
    (await db.application.create({ data: { jobId, channel, status: 'DRAFT', toEmail: job.contactEmail } }))
  await db.application.update({ where: { id: application.id }, data: { channel, toEmail: job.contactEmail, status: 'DRAFT', lastActivityAt: new Date() } })
  await db.job.update({ where: { id: jobId }, data: { status: 'DRAFTING' } })

  const log = opts.log
  const bannedPhrases = await getBannedPhrases()
  const jobForPrompt = toJobForPrompt(job)

  // Fast mode (auto-apply) keeps going on the lite model once the primary model's daily quota is gone.
  const draftModel: 'primary' | 'lite' = opts.fast && (await getAiUsageSummary()).primaryRemaining < 2 ? 'lite' : 'primary'
  try {
    if (channel === 'email') {
      const result = await humanizeLoop({
        ai: opts.fast ? { ...settings.ai, maxRewriteRounds: Math.min(1, settings.ai.maxRewriteRounds) } : settings.ai,
        // Fast mode keeps the judge but on the cheap model: one extra call, far fewer weak emails.
        skipJudge: false,
        judgeModel: opts.fast ? 'lite' : 'primary',
        company: job.companyName,
        log: (m) => log?.debug(`[draft ${jobId.slice(-6)}] ${m}`),
        lintCtx: {
          companyName: job.companyName,
          mustHaveSkills: job.mustHaveSkills,
          profileFacts: profile.facts,
          profileName: profile.fullName,
          stopSkills: profile.stopSkills,
          bannedPhrases,
          minWords: settings.ai.targetWords.min - 30,
          maxWords: settings.ai.targetWords.max + 40,
          kind: 'initial',
        },
        generate: async (rewrite) => {
          const input = { profile, job: jobForPrompt, ai: settings.ai, extraNote: opts.note, rewrite }
          const r = await generateJson({
            task: rewrite ? 'rewrite' : 'draft',
            model: draftModel,
            schema: draftSchema,
            system: draftSystemPrompt(input),
            prompt: draftUserPrompt(input),
            temperature: rewrite ? 0.8 : 0.9,
            maxOutputTokens: 8192,
          })
          return { subject: r.data.subject, body: r.data.body, model: r.model }
        },
      })
      const selectedIndex = result.passed ? result.versions.length - 1 : result.versions.findIndex((v) => v.subject === result.subject && v.body === result.body)
      await persistVersions(application.id, 'initial', result.versions, Math.max(0, selectedIndex))
      const status = result.passed ? 'REVIEW' : 'NEEDS_HUMAN'
      await db.application.update({ where: { id: application.id }, data: { status, lastActivityAt: new Date() } })
      await db.job.update({ where: { id: jobId }, data: { status: 'REVIEW' } })
      if (!result.passed) {
        await notify('review_needed', `Draft needs a human: ${job.title} at ${job.companyName}`, `The humanizer could not get a clean draft in ${result.rounds} rounds.`, `/applications/${application.id}`)
      }
    } else {
      const letter = await writeCoverLetter(job, profile, settings, bannedPhrases, 'primary')
      await db.application.update({
        where: { id: application.id },
        data: { status: 'REVIEW', coverLetter: letter.coverLetter, answers: json(letter.answers), lastActivityAt: new Date() },
      })
      await db.job.update({ where: { id: jobId }, data: { status: 'REVIEW' } })
    }
  } catch (err) {
    await db.application.update({ where: { id: application.id }, data: { status: 'NEEDS_HUMAN', notes: `Draft failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1000) } })
    await db.job.update({ where: { id: jobId }, data: { status: 'REVIEW' } })
    throw err
  }

  return db.application.findUniqueOrThrow({ where: { id: application.id }, include: { drafts: { where: { isSelected: true }, take: 1 } } })
}

/**
 * Cover letter + short form answers for an ATS/portal application (one AI call), cleaned by
 * the same deterministic linter as the emails. Used by drafting and by the browser agent.
 */
export async function writeCoverLetter(
  job: Prisma.JobGetPayload<{ include: { score: true } }>,
  profile: ProfileForPrompt,
  settings: AppSettings,
  bannedPhrases: Awaited<ReturnType<typeof getBannedPhrases>>,
  model: 'primary' | 'lite',
): Promise<{ coverLetter: string; answers: Record<string, unknown>; model: string }> {
  const p = coverLetterPrompt(profile, toJobForPrompt(job), settings.ai)
  const r = await generateJson({ task: 'cover_letter', model, schema: coverLetterSchema, system: p.system, prompt: p.prompt, temperature: 0.8, maxOutputTokens: 12288 })
  const lint = lintEmail(`${job.title} at ${job.companyName}`, r.data.coverLetter, {
    companyName: job.companyName,
    mustHaveSkills: job.mustHaveSkills,
    profileFacts: profile.facts,
    profileName: profile.fullName,
    stopSkills: profile.stopSkills,
    bannedPhrases,
    minWords: 130,
    maxWords: 260,
    kind: 'initial',
  })
  return { coverLetter: lint.fixedBody, answers: { ...r.data.answers, lint: { passed: lint.passed, errors: lint.errors, warnings: lint.warnings } }, model: r.model }
}

export type ProfileAndSettings = { profile: ProfileForPrompt; settings: AppSettings }
