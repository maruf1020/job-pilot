import { ok, route } from '@/lib/api/response'
import { db } from '@/lib/db'

/** GET /api/portal-accounts → site logins the agent uses (passwords are never listed). */
export const GET = route(async () => {
  const rows = await db.portalAccount.findMany({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, host: true, email: true, status: true, statusUrl: true, lastLoginAt: true, lastError: true, createdAt: true },
  })
  return ok(rows)
})
