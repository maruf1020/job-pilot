import { z } from 'zod'
import { badRequest, ok, readJson, route } from '@/lib/api/response'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { applyProfileToSettings } from '@/lib/settings/derive'
import { searchPrefsSchema, STEP_COUNT, stepDef, stepSchema, toDerivePrefs } from '@/components/onboarding/model'
import { loadOnboarding, saveProfile } from './store'

/** GET -> the profile, the "where to look" answers, AI key count and the step to resume at. */
export const GET = route(async () => {
  const user = await requireUser()
  return ok(await loadOnboarding({ name: user.name, email: user.email }))
})

const patchSchema = z.object({
  step: z.number().int().min(1).max(STEP_COUNT),
  data: z.record(z.string(), z.unknown()).optional(),
  prefs: searchPrefsSchema.optional(),
})

/**
 * PATCH { step, data, prefs? }: saves one step of the onboarding form. `data` may only hold that
 * step's fields (validated per step), so the person can leave after any step and come back.
 */
export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readJson(req, patchSchema)
  const def = stepDef(body.step)
  if (def.fields.length) {
    const data = stepSchema(body.step).parse(body.data ?? {})
    await saveProfile(data)
  } else if (body.data && Object.keys(body.data).length) {
    throw badRequest(`Step ${body.step} has no fields to save`)
  }
  if (def.id === 'look' && body.prefs && body.prefs.countries.length) {
    const profile = await db.candidateProfile.findUnique({ where: { id: 1 }, select: { salaryCurrency: true } })
    // The search settings follow the answers right away, so a person who stops here still searches the right countries.
    await applyProfileToSettings(toDerivePrefs(body.prefs, profile?.salaryCurrency))
  }
  return ok(await loadOnboarding({ name: user.name, email: user.email }), { message: 'Saved' })
})
