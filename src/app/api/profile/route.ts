import { ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { profileInputSchema } from '@/components/onboarding/model'
import { saveProfile } from '@/app/api/onboarding/store'
import { photoPath } from './photo/store'

export const GET = route(async () => {
  const [profile, resume] = await Promise.all([
    db.candidateProfile.findUnique({ where: { id: 1 } }),
    db.resumeFile.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' }, select: { id: true, fileName: true, sizeBytes: true, createdAt: true, parsedAt: true } }),
  ])
  return ok({ profile, resume, hasPhoto: photoPath() !== null })
})

/** PATCH: any profile fields (the same schema the onboarding steps use); only the sent keys change. */
export const PATCH = route(async (req) => {
  const body = await readJson(req, profileInputSchema.strict())
  const profile = await saveProfile(body)
  return ok(profile, { message: 'Profile saved' })
})
