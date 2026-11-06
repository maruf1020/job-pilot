import { PDFParse } from 'pdf-parse'
import type { Prisma } from '@/generated/prisma/client'
import { generateJson } from '@/lib/ai/gemini'
import { parseResumePrompt } from '@/lib/ai/prompts'
import { resumeProfileSchema } from '@/lib/ai/schemas'
import { invalidateCandidateContext } from '@/lib/candidate/load'
import { sha256 } from '@/lib/crypto'
import { db } from '@/lib/db'

const json = (v: unknown) => v as Prisma.InputJsonValue

export async function extractPdfText(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data: Uint8Array.from(data) })
  try {
    const r = await parser.getText()
    return (r.text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

/** Store the uploaded resume as the active file (deactivating older ones). */
export async function storeResumeFile(data: Buffer, fileName: string, mimeType = 'application/pdf') {
  await db.resumeFile.updateMany({ where: { isActive: true }, data: { isActive: false } })
  return db.resumeFile.create({
    data: { fileName, mimeType, sizeBytes: data.length, sha256: sha256(data), data: Uint8Array.from(data), isActive: true },
    select: { id: true, fileName: true, sizeBytes: true, createdAt: true },
  })
}

const LINK_KEYS = ['linkedin', 'github', 'portfolio', 'behance', 'dribbble', 'website'] as const
const LEVELS = new Set(['native', 'fluent', 'professional', 'conversational', 'basic'])

const has = (v: unknown) => (typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : v != null)
const clean = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** An ISO2 code from the model, or null when it gave a name or something unclear. */
function iso2(v: string | null | undefined): string | null {
  const c = clean(v)?.toUpperCase() ?? null
  return c && /^[A-Z]{2}$/.test(c) ? c : null
}

/**
 * Parse resume text with the AI and upsert the CandidateProfile.
 * Career fields (headline, summary, skills, titles, facts, experience, education, years) are what a
 * re-parse is for and are refreshed. Personal fields (name parts, contact, city/country, links,
 * languages, profession, degree) are written only where the profile has no value yet, so nothing the
 * person typed is ever overwritten. User-only fields (signature, notice period, salary, stop skills,
 * work rights, email voice) are never touched.
 */
export async function buildProfileFromText(resumeText: string) {
  const p = parseResumePrompt(resumeText)
  const r = await generateJson({ task: 'parse_resume', model: 'primary', schema: resumeProfileSchema, system: p.system, prompt: p.prompt, temperature: 0.2, maxOutputTokens: 4096 })
  const d = r.data
  const existing = await db.candidateProfile.findUnique({ where: { id: 1 } })
  /** The parsed value only when the profile has nothing there yet. */
  const fill = <T>(current: unknown, parsed: T): NonNullable<T> | undefined => (has(current) || !has(parsed) ? undefined : (parsed as NonNullable<T>))

  const oldLinks = (existing?.links && typeof existing.links === 'object' && !Array.isArray(existing.links) ? existing.links : {}) as Record<string, unknown>
  const links: Record<string, unknown> = { ...oldLinks }
  let linksChanged = false
  for (const k of LINK_KEYS) {
    const v = clean(d.links?.[k])
    if (v && !has(oldLinks[k])) {
      links[k] = v
      linksChanged = true
    }
  }
  const languageLevels = d.languages.filter((l) => clean(l.name)).map((l) => ({ name: l.name.trim(), level: l.level && LEVELS.has(l.level.toLowerCase()) ? l.level.toLowerCase() : 'professional' }))
  const city = clean(d.city)
  const country = iso2(d.country)
  // profession has a column default, so "no value yet" means a profile that was never parsed or filled in.
  const freshProfile = !existing || (!existing.parsedAt && existing.skills.length === 0 && existing.titles.length === 0)

  const career = {
    headline: d.headline,
    yearsExperience: d.yearsExperience,
    summary: d.summary,
    skills: d.skills,
    titles: d.titles,
    facts: d.facts,
    experience: json(d.experience),
    education: json(d.education),
    resumeText,
    parsedAt: new Date(),
  }
  const personal = {
    fullName: fill(existing?.fullName, clean(d.fullName)),
    givenName: fill(existing?.givenName, clean(d.givenName)),
    familyName: fill(existing?.familyName, clean(d.familyName)),
    email: fill(existing?.email, clean(d.email)),
    phone: fill(existing?.phone, clean(d.phone)),
    location: fill(existing?.location, clean(d.location) ?? ([city, country].filter(Boolean).join(', ') || null)),
    city: fill(existing?.city, city),
    country: fill(existing?.country, country),
    links: linksChanged ? json(links) : undefined,
    languages: fill(existing?.languages, languageLevels.map((l) => l.name)),
    languageLevels: has(existing?.languageLevels) || !languageLevels.length ? undefined : json(languageLevels),
    profession: freshProfile && d.profession ? d.profession : undefined,
    degree: fill(existing?.degree, clean(d.degree)),
  }
  // Prisma treats undefined as "leave as is".
  const update = { ...career, ...personal }
  const saved = await db.candidateProfile.upsert({
    where: { id: 1 },
    update,
    create: { id: 1, ...update, fullName: personal.fullName ?? clean(d.fullName) ?? '' },
  })
  invalidateCandidateContext()
  return saved
}

export async function importResume(data: Buffer, fileName: string) {
  const file = await storeResumeFile(data, fileName)
  const text = await extractPdfText(data)
  if (text.length < 200) throw new Error('Could not extract text from the PDF (scanned image?). Paste the resume text instead.')
  const profile = await buildProfileFromText(text)
  await db.resumeFile.update({ where: { id: file.id }, data: { parsedAt: new Date() } })
  return { file, profile }
}
