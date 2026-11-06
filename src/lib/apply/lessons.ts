import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { fillPlaceholders, scrubPersonal, type CandidateContext } from '@/lib/candidate/context'
import { loadCandidateContext } from '@/lib/candidate/load'
import { hostOf } from './match'

/**
 * Site lessons: what the form agents learned per kind of application site, shared between installs
 * (SiteLesson table). A lesson is knowledge about a site, never about a person: every write runs through
 * scrubPersonal (the person's values become {placeholders}) and every read through fillPlaceholders (the
 * current person's values go back in).
 *
 * Row conventions (the knowledge import uses the same ones, so rows match):
 * - fingerprint = sha256 hex of `${type}|${kind}|${host ?? ''}|${lesson}`, lesson being the stored, scrubbed text
 * - type 'lesson': what worked (outcome submitted | review | pinned | ...)
 * - type 'diagnosis': why a run stopped (outcome 'diagnosis'); the lesson column holds the fix hint ('' when none)
 * - type 'fix': a second-look fix (outcome 'fixed'), kind = host
 * Repeats bump `hits` instead of adding rows. Seed lessons stay in code (SEED_LESSONS).
 */

/**
 * Lessons learned by hand on live forms before the driver kept its own, as templates: {placeholders}
 * are filled with the current person's details when read.
 */
export const SEED_LESSONS: Record<string, string[]> = {
  smartrecruiters: [
    'SmartRecruiters: Title, Company and Institution boxes keep a value only when picked from the suggestions: fill the text, wait 2000, press ArrowDown, press Enter.',
    'SmartRecruiters: "Preliminary questions" are searchable lists; click the box, then click the option (field of study, university "Other" when the school is not listed, gender from the saved answers).',
    'SmartRecruiters: experience dates use a month picker: click the box, press "Previous year" until the year shows, click the month.',
    'SmartRecruiters: after the CV upload it adds work and education entries read from the CV; an entry with an empty Title ("Title is required") must get a real title from the candidate\'s jobs (then Save) or be removed with its "Delete experience" / "Delete education" button. Keep one entry per real job.',
    'SmartRecruiters: text boxes refuse ";" ("This field cannot contain following characters: ;"): write commas instead.',
    'SmartRecruiters: City is the list entry for "{city}" in {country}; never accept another town the list offers. If {city} is not offered, click "Cannot find your city? Click here to fill in manually" and type {city}.',
    'SmartRecruiters "Preliminary questions": language levels, office and relocation questions come from the saved answers; diversity questions (age band, disability, orientation, ethnicity, veteran, first-generation student) use the saved diversity answers, otherwise the prefer-not-to-say option; then the privacy box and Submit.',
  ],
  recruitee: [
    'Recruitee: the phone box starts with the local dial code; fill it with the full {phone} number and the country switches itself.',
    'Recruitee: yes/no questions are radio buttons drawn as labels; click the label text (Yes / No).',
  ],
  workday: [
    'Workday: legal name is Given Name "{givenName}" and Family Name "{familyName}"; Phone Device Type is Mobile; dates are typed as month then year.',
    'Workday: press "Save and Continue" after each page; the last page is Review with a Submit button.',
  ],
  teamtailor: [
    'Teamtailor: "Select an option" dropdowns open a menu of choices; click the dropdown, then click the option. Never press "Borrar selección de archivos" or other clear-files buttons.',
  ],
  oracle: ['Oracle Cloud careers: after ticking the terms box, press "Agree" in the Terms and Conditions pop-up.'],
  workable: ['Workable: the cover letter box only takes typed text; the CV upload shows the file name when it worked.'],
}

/** Categories whose fix hint is a technique an agent can use; the others only the person can resolve. */
const HINT_CATEGORIES = ['widget', 'validation', 'navigation']

export function lessonFingerprint(type: string, kind: string, host: string | null | undefined, lesson: string): string {
  return createHash('sha256').update(`${type}|${kind}|${host ?? ''}|${lesson}`).digest('hex')
}

async function contextOf(ctx?: CandidateContext): Promise<CandidateContext> {
  return ctx ?? loadCandidateContext()
}

/** Distinct texts in order, keeping the first time each was seen. */
function distinct(texts: string[]): string[] {
  return [...new Set(texts.filter(Boolean))]
}

/**
 * Lessons for the form driver on this kind of site: the seed templates, the last 6 pinned lessons (checked
 * by hand on the live page; vague model-written ones once pushed the concrete widget tricks out of the
 * window) and the last 8 distinct learned ones (one lesson repeated 8 times pushed the useful ones out).
 */
export async function lessonsFor(kind: string, ctx?: CandidateContext): Promise<string[]> {
  const c = await contextOf(ctx)
  let pinned: string[] = []
  let learned: string[] = []
  try {
    const [p, l] = await Promise.all([
      db.siteLesson.findMany({ where: { kind, type: 'lesson', outcome: 'pinned' }, orderBy: { createdAt: 'desc' }, take: 6, select: { lesson: true } }),
      db.siteLesson.findMany({ where: { kind, type: 'lesson', NOT: { outcome: { in: ['pinned', 'seed'] } } }, orderBy: { createdAt: 'desc' }, take: 8, select: { lesson: true } }),
    ])
    pinned = p.map((r) => r.lesson).reverse()
    learned = l.map((r) => r.lesson).reverse()
  } catch {
    // No lessons table reachable: the seeds still help.
  }
  return distinct([...(SEED_LESSONS[kind] ?? []), ...pinned, ...learned]).map((t) => fillPlaceholders(t, c))
}

/** How earlier runs could have got past where they were stuck on this kind of site (from diagnoseStop). */
export async function hintsFor(kind: string, ctx?: CandidateContext): Promise<string[]> {
  const c = await contextOf(ctx)
  try {
    const rows = await db.siteLesson.findMany({
      where: { kind, type: 'diagnosis', category: { in: HINT_CATEGORIES }, NOT: { lesson: '' } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { lesson: true },
    })
    return distinct(rows.map((r) => r.lesson).reverse()).map((t) => fillPlaceholders(t, c))
  } catch {
    return []
  }
}

/** What earlier second looks fixed on this host (fixer.ts), last 5. */
export async function fixLessonsFor(host: string, ctx?: CandidateContext): Promise<string[]> {
  const c = await contextOf(ctx)
  try {
    const rows = await db.siteLesson.findMany({ where: { type: 'fix', host, outcome: 'fixed' }, orderBy: { createdAt: 'desc' }, take: 5, select: { lesson: true } })
    return distinct(rows.map((r) => r.lesson).reverse()).map((t) => fillPlaceholders(t, c))
  } catch {
    return []
  }
}

interface LessonRowInput {
  type: 'lesson' | 'diagnosis' | 'fix'
  kind: string
  host: string | null
  outcome: string
  lesson: string
  category?: string | null
  pattern?: string | null
  blocker?: string | null
}

/** True when the row was written (or its hits bumped). */
async function upsertLesson(row: LessonRowInput, ctx?: CandidateContext): Promise<boolean> {
  try {
    const c = await contextOf(ctx)
    const scrub = (t: string | null | undefined) => (t ? scrubPersonal(t, c) : null)
    const lesson = scrubPersonal(row.lesson, c)
    const fingerprint = lessonFingerprint(row.type, row.kind, row.host, lesson)
    await db.siteLesson.upsert({
      where: { fingerprint },
      update: { hits: { increment: 1 } },
      create: {
        fingerprint,
        type: row.type,
        kind: row.kind,
        host: row.host,
        outcome: row.outcome,
        lesson,
        category: row.category ?? null,
        pattern: scrub(row.pattern),
        blocker: scrub(row.blocker),
      },
    })
    return true
  } catch {
    // Losing a lesson is not worth failing an application over.
    return false
  }
}

/** Keep what worked on a form of this kind of site (outcome submitted | review | pinned | ...). */
export async function keepLesson(input: { kind: string; url?: string | null; host?: string | null; lesson: string; outcome: string }, ctx?: CandidateContext): Promise<boolean> {
  const lesson = input.lesson.trim().slice(0, 400)
  if (!lesson) return false
  return upsertLesson({ type: 'lesson', kind: input.kind, host: input.host ?? (input.url ? hostOf(input.url) || null : null), outcome: input.outcome, lesson }, ctx)
}

/** Keep why a run stopped (diagnoseStop), with its fix hint for the next run on this kind of site. */
export async function keepDiagnosis(
  input: { kind: string; url?: string | null; host?: string | null; category: string; pattern: string; blocker: string; fixHint: string | null | undefined },
  ctx?: CandidateContext,
): Promise<void> {
  await upsertLesson(
    {
      type: 'diagnosis',
      kind: input.kind,
      host: input.host ?? (input.url ? hostOf(input.url) || null : null),
      outcome: 'diagnosis',
      lesson: (input.fixHint ?? '').slice(0, 300),
      category: input.category,
      pattern: input.pattern.slice(0, 120),
      blocker: input.blocker.slice(0, 300),
    },
    ctx,
  )
}

/** Keep a second-look fix that did something on this host (fixer.ts). */
export async function keepFixLesson(input: { host: string; lesson: string | null | undefined; diagnosis?: string | null; reason?: string | null; done: number }, ctx?: CandidateContext): Promise<void> {
  const lesson = (input.lesson ?? '').trim().slice(0, 400)
  if (!lesson || input.done <= 0 || !input.host) return
  await upsertLesson(
    {
      type: 'fix',
      kind: input.host,
      host: input.host,
      outcome: 'fixed',
      lesson,
      pattern: input.diagnosis?.slice(0, 120) ?? null,
      blocker: input.reason?.slice(0, 300) ?? null,
    },
    ctx,
  )
}

export interface LessonCounts {
  lessons: number
  lessons7d: number
  fixHints: number
  diagnoses7d: number
  siteKinds: number
}

/** Counts for Stats: lessons (forms that went through), fix hints and diagnoses (forms that stopped), kinds of site. */
export async function countLessons(now = Date.now()): Promise<LessonCounts> {
  const weekAgo = new Date(now - 7 * 86_400_000)
  const [lessons, lessons7d, fixHints, diagnoses7d, kinds] = await Promise.all([
    db.siteLesson.count({ where: { type: 'lesson' } }),
    db.siteLesson.count({ where: { type: 'lesson', createdAt: { gte: weekAgo } } }),
    db.siteLesson.count({ where: { type: 'diagnosis', NOT: { lesson: '' } } }),
    db.siteLesson.count({ where: { type: 'diagnosis', updatedAt: { gte: weekAgo } } }),
    db.siteLesson.findMany({ where: { type: { in: ['lesson', 'diagnosis'] } }, distinct: ['kind'], select: { kind: true } }),
  ])
  return { lessons, lessons7d, fixHints, diagnoses7d, siteKinds: kinds.length }
}
