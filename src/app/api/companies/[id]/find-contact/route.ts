import { notFound, ok, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { discoverContactForCompany } from '@/lib/pipeline/contacts'
import { webContactOptions } from '@/lib/runtime'

const HOW: Record<string, string> = {
  verified: 'mailbox confirmed by the company mail server',
  website: 'found on the company website',
  search: 'found by web search',
  guessed: 'guessed from the company domain (not verified)',
  posting: 'taken from a posting',
  company: 'from the company record',
  manual: 'entered by hand',
}

/** POST /api/companies/:id/find-contact → look up (and verify) an application address for this company now. */
export const POST = route(async (_req, { params }) => {
  const { id } = await params
  const c = await db.company.findUnique({ where: { id }, select: { id: true } })
  if (!c) throw notFound('Company')
  const web = webContactOptions()
  const r = await discoverContactForCompany(id, { force: true, ...web })
  const message = r.email
    ? `${r.email} — ${HOW[r.source ?? ''] ?? r.source}${r.jobsUpdated ? `; applied to ${r.jobsUpdated} job(s)` : ''}${web.skipVerify && r.source !== 'verified' ? ' · mailbox verification happens in the worker batch' : ''}`
    : `No address found${r.domain ? ` for ${r.domain}` : ' (company domain unknown; set it on the company)'}${r.notes.length ? `. ${r.notes[r.notes.length - 1]}` : ''}`
  return ok(r, { message })
})
