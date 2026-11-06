import { db } from '@/lib/db'
import { boardFromUrl } from '@/lib/sponsors/board-registry'

/**
 * A form the agent reached on Greenhouse, Lever, Ashby, Workday... names the company's board. A company
 * without a board gets it (boardSource "job-link"), so the board feed brings its other jobs straight to
 * their forms. The slug format belongs to the board registry; this only stores what it reads.
 */
export async function rememberCompanyBoard(companyId: string, urls: string[], log?: (m: string) => void): Promise<boolean> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { atsType: true, atsSlug: true, name: true } })
  if (!company || (company.atsType && company.atsSlug)) return false
  for (const url of urls) {
    const ref = boardFromUrl(url)
    if (!ref) continue
    await db.company.update({ where: { id: companyId }, data: { atsType: ref.atsType, atsSlug: ref.slug, boardSource: 'job-link', boardCheckedAt: new Date() } })
    log?.(`noted ${company.name}'s ${ref.atsType} board (${ref.slug}) for the job search`)
    return true
  }
  return false
}
