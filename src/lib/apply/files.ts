import fs from 'node:fs'
import path from 'node:path'
import { sha1 } from '@/lib/crypto'
import { db } from '@/lib/db'

/**
 * Files the agent uploads: your active CV (written once from the database) and a cover
 * letter PDF per application (rendered by a headless Chromium, cached by its text).
 */

const FILES_DIR = path.resolve(process.cwd(), 'storage', 'apply-files')

export async function resumeFilePath(): Promise<string> {
  const r = await db.resumeFile.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' } })
  if (!r) throw new Error('No CV uploaded. Add it in Settings → Profile.')
  const name = r.fileName.replace(/[^\w.-]+/g, '-') || 'CV.pdf'
  const dir = path.join(FILES_DIR, 'cv', r.sha256.slice(0, 12))
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, Buffer.from(r.data))
  }
  return file
}

export type CvVariant = 'frontend' | 'fullstack' | 'backend'

/** Which CV version fits a title: full-stack titles first, then frontend, then backend, else full-stack. */
export function cvVariantFor(title: string): CvVariant {
  const t = title.toLowerCase()
  if (/full[\s-]?stack/.test(t)) return 'fullstack'
  if (/front[\s-]?end|\breact\b|\bvue\b|\bangular\b|\bui\b|design system|web developer|web engineer/.test(t)) return 'frontend'
  if (/back[\s-]?end|\bnode(\.?js)?\b|\bnestjs\b|\bapi\b|server|platform|integration/.test(t)) return 'backend'
  return 'fullstack'
}

/**
 * The PDF in storage/apply-files/cv/variants/<variant>/ (one file, named the way employers should see it,
 * e.g. Alex-Rivera-CV.pdf), or null when there is none.
 */
export function cvVariantPath(variant: CvVariant, baseDir = FILES_DIR): string | null {
  const dir = path.join(baseDir, 'cv', 'variants', variant)
  if (!fs.existsSync(dir)) return null
  const pdf = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort()[0]
  return pdf ? path.join(dir, pdf) : null
}

/**
 * The CV to upload for this title: its variant when variants are switched on (Settings → Browser) and the
 * file exists, otherwise the main CV.
 */
export async function cvForTitle(title: string, useVariants: boolean): Promise<{ path: string; variant: CvVariant | 'main' }> {
  if (useVariants) {
    const variant = cvVariantFor(title)
    const file = cvVariantPath(variant)
    if (file) return { path: file, variant }
  }
  return { path: await resumeFilePath(), variant: 'main' }
}

/** The person's photo for forms with a photo field (storage/photo.jpg, never committed); null when there is none. */
export function photoFilePath(): string | null {
  for (const name of ['photo.jpg', 'photo.jpeg', 'photo.png']) {
    const file = path.resolve(process.cwd(), 'storage', name)
    if (fs.existsSync(file)) return file
  }
  return null
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** Cover letter as a clean one-page PDF named "<Your-Name>-Cover-Letter-<Company>.pdf". */
export async function coverLetterPdfPath(applicationId: string, text: string, fullName: string, company: string): Promise<string> {
  const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'Company'
  const dir = path.join(FILES_DIR, 'cover', applicationId, sha1(text).slice(0, 10))
  const file = path.join(dir, `${safe(fullName)}-Cover-Letter-${safe(company)}.pdf`)
  if (fs.existsSync(file)) return file
  fs.mkdirSync(dir, { recursive: true })
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 22mm 22mm 20mm 22mm; }
    body { font-family: Georgia, 'Times New Roman', serif; font-size: 11.5pt; line-height: 1.5; color: #111; }
    p { margin: 0 0 10pt 0; }
  </style></head><body>${paragraphs}</body></html>`
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.pdf({ path: file, format: 'A4', printBackground: false })
  } finally {
    await browser.close()
  }
  return file
}

const SHOTS_DIR = path.resolve(process.cwd(), 'storage', 'apply-shots')

export function screenshotPath(attemptId: string, n: number, label: string): { abs: string; rel: string } {
  const name = `${String(n).padStart(2, '0')}-${label.replace(/[^\w-]+/g, '-').slice(0, 40)}.jpg`
  return { abs: path.join(SHOTS_DIR, attemptId, name), rel: `${attemptId}/${name}` }
}

/** Absolute path of a stored screenshot, or null when the name is not a safe relative path. */
export function resolveScreenshot(rel: string): string | null {
  if (!/^[\w-]+\/[\w.-]+\.jpg$/.test(rel)) return null
  const abs = path.join(SHOTS_DIR, rel)
  return abs.startsWith(SHOTS_DIR) && fs.existsSync(abs) ? abs : null
}

/** The step pictures Gemini looked at (not the filled-form and confirmation shots, which are kept). */
const STEP_SHOT_RE = /-(gemini-step-\d+|stopped-here)\.jpg$/

/** Delete Gemini step screenshots older than `days` (the disk is small); returns how many went. */
export function pruneStepShots(days = 7, now = Date.now()): number {
  let removed = 0
  const cutoff = now - days * 86_400_000
  let dirs: string[] = []
  try {
    dirs = fs.readdirSync(SHOTS_DIR)
  } catch {
    return 0
  }
  for (const dir of dirs) {
    let files: string[] = []
    try {
      files = fs.readdirSync(path.join(SHOTS_DIR, dir))
    } catch {
      continue
    }
    for (const f of files) {
      if (!STEP_SHOT_RE.test(f)) continue
      const abs = path.join(SHOTS_DIR, dir, f)
      try {
        if (fs.statSync(abs).mtimeMs < cutoff) {
          fs.unlinkSync(abs)
          removed++
        }
      } catch {
        // gone already
      }
    }
  }
  return removed
}
