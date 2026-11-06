import { badRequest, ok, route } from '@/lib/api/response'
import { MAIL_FOLDERS, type MailFolder } from '@/lib/mail/folders'
import { loadMail } from '@/lib/mail/loader'

/** GET /api/mail?folder=needs-answer&page=1 -> one page of a mail folder plus the count of every folder. */
export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams
  const folder = (sp.get('folder') ?? 'needs-answer') as MailFolder
  if (!MAIL_FOLDERS.includes(folder)) throw badRequest(`Unknown folder "${folder}"`)
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1)
  return ok(await loadMail(folder, page))
})
