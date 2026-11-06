import { badRequest, ok, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { buildProfileFromText, extractPdfText, importResume, storeResumeFile } from '@/lib/resume/parse'

const MAX_BYTES = 5 * 1024 * 1024

/** POST multipart { file } → store + parse with AI (add ?parse=false to only store). */
export const POST = route(async (req) => {
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') throw badRequest('Upload a PDF as "file"')
  if (file.size > MAX_BYTES) throw badRequest('PDF larger than 5 MB')
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) throw badRequest('Only PDF resumes are supported')
  const data = Buffer.from(await file.arrayBuffer())
  const parse = new URL(req.url).searchParams.get('parse') !== 'false'
  if (!parse) {
    const stored = await storeResumeFile(data, file.name, file.type || 'application/pdf')
    const text = await extractPdfText(data).catch(() => '')
    if (text) await db.candidateProfile.updateMany({ where: { id: 1 }, data: { resumeText: text } })
    return ok({ file: stored, parsed: false }, { message: 'Resume stored' })
  }
  const r = await importResume(data, file.name)
  return ok({ file: r.file, profile: r.profile, parsed: true }, { message: 'Resume parsed into your profile' })
})

/** GET → download the active resume. */
export const GET = route(async () => {
  const file = await db.resumeFile.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' } })
  if (!file) throw badRequest('No resume uploaded')
  return new Response(Buffer.from(file.data), { headers: { 'content-type': file.mimeType, 'content-disposition': `attachment; filename="${file.fileName}"` } })
})

/** PUT → re-parse the stored resume text into the profile. */
export const PUT = route(async () => {
  const profile = await db.candidateProfile.findUnique({ where: { id: 1 }, select: { resumeText: true } })
  let text = profile?.resumeText ?? ''
  if (!text) {
    const file = await db.resumeFile.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' } })
    if (!file) throw badRequest('No resume to parse')
    text = await extractPdfText(Buffer.from(file.data))
  }
  const updated = await buildProfileFromText(text)
  return ok(updated, { message: 'Profile re-parsed from the resume' })
})
