import { z } from 'zod'
import { HttpError, ok, readJson, route } from '@/lib/api/response'
import { reseedStandardAnswers } from '@/lib/apply/answer-bank'
import { requireUser } from '@/lib/auth'
import { invalidateCandidateContext } from '@/lib/candidate/load'
import { db } from '@/lib/db'
import { applyProfileToSettings } from '@/lib/settings/derive'
import { getSettings } from '@/lib/settings/service'
import { missingForFinish, searchPrefsSchema, toDerivePrefs } from '@/components/onboarding/model'
import { readPrefs } from '../store'

const bodySchema = z.object({ prefs: searchPrefsSchema.optional() })

/**
 * POST /api/onboarding/finish: checks the minimum answers, builds Settings from the profile
 * (search countries and tiers, queries, ranking words, title rules, time zone), seeds the form answers, and
 * marks the account as onboarded so the app opens.
 */
export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readJson(req, bodySchema)
  const [profile, settings] = await Promise.all([db.candidateProfile.findUnique({ where: { id: 1 } }), getSettings()])
  const prefs = body.prefs ?? readPrefs(settings, profile)

  const missing = missingForFinish(profile, prefs)
  if (missing.length) {
    throw new HttpError(
      422,
      `Still missing: ${missing.map((m) => m.label).join(', ')}`,
      missing.map((m) => ({ path: `step ${m.step}`, message: m.label })),
    )
  }

  await applyProfileToSettings(toDerivePrefs(prefs, profile?.salaryCurrency))
  await reseedStandardAnswers()
  invalidateCandidateContext()
  const updated = await db.user.update({ where: { id: user.id }, data: { onboardedAt: new Date() }, select: { onboardedAt: true } })
  return ok({ onboardedAt: updated.onboardedAt }, { message: 'All set' })
})
