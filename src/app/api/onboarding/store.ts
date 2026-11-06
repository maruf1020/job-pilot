import type { Prisma } from '@/generated/prisma/client'
import { countryNameOf } from '@/lib/candidate/context'
import { invalidateCandidateContext } from '@/lib/candidate/load'
import { db } from '@/lib/db'
import type { AppSettings } from '@/lib/settings/schema'
import { getSettings } from '@/lib/settings/service'
import { photoPath } from '@/app/api/profile/photo/store'
import { DIVERSITY_TOPICS, firstIncompleteStep, fromEur, LINK_FIELDS, type ProfileInput, type SearchPrefs } from '@/components/onboarding/model'

/**
 * Server side of the profile form (onboarding steps and Settings > Profile): turns validated input
 * into CandidateProfile columns and reads the "where to look" answers back from Settings.
 */

const json = (v: unknown) => v as Prisma.InputJsonValue

/** Validated input -> Prisma update data, with the derived columns kept in step. */
export function profileData(input: ProfileInput): Prisma.CandidateProfileUncheckedUpdateInput {
  const { links, workAuth, languageLevels, experience, education, diversity, emailVoice, ...plain } = input
  const data: Prisma.CandidateProfileUncheckedUpdateInput = { ...plain }

  if (links) {
    const known = new Set<string>(LINK_FIELDS.map((l) => l.key))
    data.links = json(Object.fromEntries(Object.entries(links).filter(([k, v]) => known.has(k) && v.trim())))
  }
  if (workAuth) data.workAuth = json({ needsSponsorship: workAuth.needsSponsorship, rightToWork: [...new Set(workAuth.rightToWork)], authorizationText: workAuth.authorizationText ?? null })
  if (languageLevels) {
    data.languageLevels = json(languageLevels)
    // The older string list is still read by a few prompts.
    data.languages = languageLevels.map((l) => `${l.name} (${l.level})`)
  }
  if (experience) data.experience = json(experience.filter((e) => e.company || e.title).map((e) => ({ ...e, bullets: e.bullets ?? [] })))
  if (education) data.education = json(education.filter((e) => e.school))
  if (diversity) {
    // Only known topics; a missing topic is answered "Prefer not to say".
    const clean = Object.fromEntries(DIVERSITY_TOPICS.map((t) => [t.key, diversity[t.key]?.trim() || null]))
    data.diversity = json(clean)
    data.gender = clean.gender ?? null
  }
  if (emailVoice) data.emailVoice = json(emailVoice)
  if (input.city !== undefined || input.country !== undefined) {
    // "City, Country" is what most forms want in a single location field.
    const loc = [input.city, countryNameOf(input.country ?? null)].filter(Boolean).join(', ')
    if (loc) data.location = loc
  }
  return data
}

/** Writes profile fields (creating the row on first save) and refreshes the candidate cache. */
export async function saveProfile(input: ProfileInput) {
  const data = profileData(input)
  const row = await db.candidateProfile.upsert({
    where: { id: 1 },
    update: data,
    create: { ...(data as Prisma.CandidateProfileUncheckedCreateInput), id: 1, fullName: input.fullName ?? '' },
  })
  invalidateCandidateContext()
  return row
}

/** The "where to look" answers as applyProfileToSettings stored them in Settings. */
export function readPrefs(settings: AppSettings, profile: { salaryCurrency?: string | null } | null): SearchPrefs {
  const minEur = settings.ranking.minSalaryEur
  return {
    countries: settings.search.countries ?? [],
    // toDerivePrefs puts the first-choice countries in the first tier.
    firstChoice: settings.search.priorityTiers[0] ?? [],
    includeRemote: settings.search.includeRemote,
    remoteOnly: settings.search.remoteOnly,
    minSalary: minEur && minEur > 0 ? fromEur(minEur, profile?.salaryCurrency || 'EUR') : null,
  }
}

export interface OnboardingPayload {
  profile: Awaited<ReturnType<typeof db.candidateProfile.findUnique>>
  resume: { id: string; fileName: string; sizeBytes: number; createdAt: Date; parsedAt: Date | null } | null
  prefs: SearchPrefs
  aiKeys: number
  hasPhoto: boolean
  account: { name: string; email: string | null }
  /** First step whose answers were never saved: where the form resumes. */
  step: number
}

export async function loadOnboarding(account: { name: string; email: string | null }): Promise<OnboardingPayload> {
  const [profile, resume, aiKeys, settings] = await Promise.all([
    db.candidateProfile.findUnique({ where: { id: 1 } }),
    db.resumeFile.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' }, select: { id: true, fileName: true, sizeBytes: true, createdAt: true, parsedAt: true } }),
    db.aiKey.count(),
    getSettings(),
  ])
  const prefs = readPrefs(settings, profile)
  return {
    profile,
    resume,
    prefs,
    aiKeys,
    hasPhoto: photoPath() !== null,
    account,
    step: firstIncompleteStep(profile, { aiKeys, hasResume: resume !== null, prefs }),
  }
}
