import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { db } from '@/lib/db'
import { autoSendRecipientProblem, unusableContactReason } from '@/lib/email/address'
import { suppressedReason } from '@/lib/email/suppression'
import { findCooldownConflict } from '@/lib/pipeline/cooldown'
import { evaluateAutoSend } from '@/lib/pipeline/decide'
import { preferredChannel } from '@/lib/pipeline/channel'
import { getSettings } from '@/lib/settings/service'
import type { AppSettings } from '@/lib/settings/schema'
import type { ProfileForPrompt } from '@/lib/ai/prompts'
import { countryNameOf } from '@/lib/candidate/context'
import { loadCandidateContext } from '@/lib/candidate/load'

/**
 * /sendready: the held email applications (REVIEW or DRAFT) that pass every check and that Gemini judges a
 * fit are queued through evaluateAutoSend, so the daily cap, block list, company cooldown, never-the-same-job
 * rule and the send window all still apply. Only addresses the app found (verified, company, posting, website)
 * are ever used; guessed addresses stay held. A draft that did not pass the humanizer is left alone.
 */

export const TRUSTED_SOURCES = ['verified', 'company', 'posting', 'website']
export const MIN_SCORE = 60
const FIT_BATCH = 20
const FIT_CACHE_DAYS = 7
/** The topics the person never wants in an application (Settings > Profile > email voice), as one regex; null when none. */
export function forbiddenTopicRegex(neverMention: string[]): RegExp | null {
  const words = neverMention.map((w) => w.trim()).filter((w) => w.length >= 2)
  if (!words.length) return null
  return new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|'), 'i')
}

const MARK = '[Telegram release]'

type Verdict = { fit: boolean; reason: string; at: number }

const cacheFile = () => path.resolve(process.cwd(), 'storage', 'telegram-fit-cache.json')

function loadCache(): Record<string, Verdict> {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as Record<string, Verdict>
  } catch {
    return {}
  }
}

function saveCache(cache: Record<string, Verdict>): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true })
    fs.writeFileSync(cacheFile(), JSON.stringify(cache))
  } catch {
    /* the cache only saves Gemini calls */
  }
}

export interface ReleaseScan {
  total: number
  /** Application ids that pass every check and would be queued. */
  ready: string[]
  /** Reason -> count for the ones that stay held. */
  held: Record<string, number>
  /** Passing checks and fit, but the draft needs a new humanizer pass first; left untouched. */
  needsDraft: number
}

async function judgeFit(apps: Array<{ jobId: string; job: Record<string, unknown> }>, cache: Record<string, Verdict>): Promise<void> {
  const todo = apps.filter((a) => !cache[a.jobId] || Date.now() - cache[a.jobId].at > FIT_CACHE_DAYS * 86_400_000)
  if (!todo.length) return
  const { generateJson } = await import('@/lib/ai/gemini')
  const { getProfileForPrompt } = await import('@/lib/pipeline/profile')
  const profile = await getProfileForPrompt()
  const settings = await getSettings()
  const verdict = z.object({ items: z.array(z.object({ id: z.string(), fit: z.boolean(), reason: z.string().max(200) })) })
  const blurb = fitBlurb(profile, settings)
  const excluded = settings.search.excludeTitleKeywords.join(', ')
  const focus = settings.portal.stackFocus
  const software = profile.candidate?.profession === 'software'
  const noun = profile.candidate?.professionNoun || 'professional'
  const rule1 = focus.length
    ? `The main work uses ${focus.join(', ')}, or is a real mix where these are a main part of the work.`
    : `The main tools and methods of the role overlap the candidate's skills${software ? '; a role built mainly on a stack the candidate has not used is not a fit' : ''}.`
  for (let i = 0; i < todo.length; i += FIT_BATCH) {
    const chunk = todo.slice(i, i + FIT_BATCH)
    const prompt = `${blurb}\n\nDecide for each job below whether it is a good fit to apply to by email. fit=true ONLY when ALL hold:\n1. ${rule1}\n2. The job is in one of the places the candidate looks for work (above), or is explicitly remote with hiring that fits where the candidate lives.\n3. The title is a ${noun} role at the candidate's level (see the target titles).${excluded ? ` Reject titles containing any of: ${excluded}.` : ''} Reject roles in a different field.\nBe strict: when unsure, fit=false. Give a short reason (max 20 words).\n\nJobs (JSON):\n${JSON.stringify(chunk.map((c) => ({ id: c.jobId, ...c.job })))}\n\nAnswer with JSON {"items":[{"id","fit","reason"}]} covering every id.`
    const r = await generateJson({ task: 'rank', model: 'lite', schema: verdict, prompt, temperature: 0.1, maxOutputTokens: 4096 })
    for (const it of r.data.items) if (chunk.some((c) => c.jobId === it.id)) cache[it.id] = { fit: it.fit, reason: it.reason, at: Date.now() }
    saveCache(cache)
  }
}

/** Who the candidate is and where they look for work, for the fit prompt: all from the profile and Settings > Search. */
export function fitBlurb(
  profile: Pick<ProfileForPrompt, 'headline' | 'yearsExperience' | 'skills' | 'titles' | 'candidate'>,
  settings: { search: Pick<AppSettings['search'], 'countries' | 'includeUk' | 'includeRemote' | 'remoteOnly' | 'outsideEurope'> },
): string {
  const c = profile.candidate
  const names = (codes: string[]) => codes.map((x) => countryNameOf(x) ?? x)
  const places = [...names(settings.search.countries), ...(settings.search.includeUk ? ['United Kingdom'] : []), ...names(settings.search.outsideEurope)]
  const where = settings.search.remoteOnly ? 'fully remote roles only' : `${[...new Set(places)].join(', ') || 'any country'}${settings.search.includeRemote ? ', or fully remote roles' : ''}`
  const lives = c?.location ? ` Lives in ${c.location}.` : ''
  const rights = c?.citizenshipNames.length ? ` Citizen of ${c.citizenshipNames.join(' and ')}.` : ''
  const sponsor = c?.workAuth.needsSponsorship === true ? ' Needs employer visa sponsorship in countries where they have no right to work (EU/EEA free movement counts for EU citizens).' : ''
  return `Candidate: ${c?.professionNoun ? `a ${c.professionNoun}, ` : ''}${profile.headline}. ${profile.yearsExperience} years. Skills: ${profile.skills.slice(0, 25).join(', ')}. Target titles: ${profile.titles.join('; ')}.${lives}${rights}${sponsor} Looks for work in: ${where}.`
}

/** Which held emails would be released now. Reads only; the Gemini fit verdicts are cached on disk. */
export async function scanReleasable(): Promise<ReleaseScan> {
  const settings = await getSettings()
  const forbidden = forbiddenTopicRegex((await loadCandidateContext()).voice.neverMention)
  const apps = await db.application.findMany({
    where: { channel: 'email', status: { in: ['REVIEW', 'DRAFT'] }, sentAt: null },
    include: { job: { include: { score: true, company: { select: { domain: true } } } }, drafts: { where: { isSelected: true, kind: 'initial' }, take: 1 } },
  })
  // Best score first, so when two jobs of one company compete the better one gets the slot.
  apps.sort((a, b) => (b.job.finalScore ?? b.job.score?.finalScore ?? 0) - (a.job.finalScore ?? a.job.score?.finalScore ?? 0))
  const held: Record<string, number> = {}
  const hold = (reason: string) => void (held[reason] = (held[reason] ?? 0) + 1)
  const stage: typeof apps = []
  const claimed = new Set<string>()

  for (const a of apps) {
    const j = a.job
    const src = j.contactEmailSource
    const score = j.finalScore ?? j.score?.finalScore ?? 0
    if (!a.toEmail) hold('no address')
    else if (src === 'guessed') hold('guessed address')
    else if (!src || !TRUSTED_SOURCES.includes(src)) hold('address source not verified')
    else if (!j.contactEmail || a.toEmail.toLowerCase() !== j.contactEmail.toLowerCase()) hold('address changed after a bounce')
    else if (unusableContactReason(a.toEmail)) hold('unusable address')
    else if (await suppressedReason(a.toEmail)) hold('block list')
    else if (autoSendRecipientProblem(a.toEmail, { name: j.companyName, domain: j.company.domain }, src)) hold('address not the company')
    else if (score < MIN_SCORE) hold(`score below ${MIN_SCORE}`)
    else if (preferredChannel(j) !== 'email') hold('form-first system')
    else {
      const conflict = await findCooldownConflict({ companyId: j.companyId, countryCode: j.countryCode, excludeApplicationId: a.id, toEmail: a.toEmail }, settings.email)
      if (conflict) {
        hold(conflict.sameJob ? 'same job before' : 'company cooldown')
      } else if (claimed.has(j.companyId)) hold('another job of the same company goes first')
      else {
        claimed.add(j.companyId)
        stage.push(a)
      }
    }
  }

  const cache = loadCache()
  await judgeFit(
    stage.map((a) => ({
      jobId: a.job.id,
      job: { title: a.job.title, company: a.job.companyName, location: a.job.location, country: a.job.countryCode, remote: a.job.remote, mustHave: a.job.mustHaveSkills, tags: a.job.tags, summary: a.job.summary, description: (a.job.description ?? '').replace(/\s+/g, ' ').slice(0, 1200) },
    })),
    cache,
  )

  const ready: string[] = []
  let needsDraft = 0
  for (const a of stage) {
    const v = cache[a.job.id]
    if (!v) hold('no fit verdict')
    else if (!v.fit) hold('Gemini: not a fit')
    else {
      const d = a.drafts[0]
      if (!d?.passed) needsDraft++
      else if (forbidden?.test(`${d.subject}\n${d.body}`)) hold('draft mentions a banned topic')
      else ready.push(a.id)
    }
  }
  return { total: apps.length, ready, held, needsDraft }
}

export interface ReleaseOutcome {
  queued: number
  refused: Record<string, number>
}

/** Queues the scanned applications through evaluateAutoSend (cap, cooldown, block list and window still apply). */
export async function releaseReady(scan: ReleaseScan): Promise<ReleaseOutcome> {
  let queued = 0
  const refused: Record<string, number> = {}
  for (const id of scan.ready) {
    const r = await evaluateAutoSend(id, { force: true, requirePassed: true })
    if (r.outcome === 'queued') {
      queued++
      await db.application.update({ where: { id }, data: { notes: `${MARK} Gemini-reviewed fit, verified address, queued for sending` } }).catch(() => undefined)
    } else {
      const key = /Daily send cap/.test(r.reason ?? '') ? 'daily cap reached' : (r.reason ?? r.outcome).slice(0, 60)
      refused[key] = (refused[key] ?? 0) + 1
    }
  }
  return { queued, refused }
}
