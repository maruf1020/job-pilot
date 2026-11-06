import { notFound, ok, route } from '@/lib/api/response'
import { db } from '@/lib/db'

export const GET = route(async (req, { params }) => {
  const { id } = await params
  const url = new URL(req.url)
  const logLimit = Math.min(2000, Number(url.searchParams.get('logLimit') ?? 500))
  const run = await db.searchRun.findUnique({
    where: { id },
    include: { sources: { orderBy: { createdAt: 'asc' } }, logs: { orderBy: { createdAt: 'asc' }, take: logLimit } },
  })
  if (!run) throw notFound('Run')
  return ok(run)
})
