import fs from 'node:fs/promises'
import { notFound, route } from '@/lib/api/response'
import { resolveScreenshot } from '@/lib/apply/files'
import { db } from '@/lib/db'

/** GET /api/portal-attempts/:id/screenshot?n=1 → JPEG screenshot n (1-based) of an attempt. */
export const GET = route(async (req, { params }) => {
  const { id } = await params
  const n = Number(new URL(req.url).searchParams.get('n') ?? '1')
  const attempt = await db.portalAttempt.findUnique({ where: { id }, select: { screenshots: true } })
  const rel = attempt?.screenshots[n - 1]
  const abs = rel ? resolveScreenshot(rel) : null
  if (!abs) throw notFound('Screenshot')
  const data = await fs.readFile(abs)
  return new Response(new Uint8Array(data), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' } })
})
