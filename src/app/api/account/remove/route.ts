import { z } from 'zod'
import { removeOwnerData } from '@/lib/account/remove'
import { HttpError, ok, readJson, route } from '@/lib/api/response'
import { normalizeUsername, requireUser, signOut } from '@/lib/auth'
import { verifyPassword } from '@/lib/auth/password'
import { db } from '@/lib/db'

const bodySchema = z.object({ name: z.string().trim().min(1).max(80), password: z.string().min(1).max(200) })

/**
 * POST { name, password }: "Remove my data". Both must match the signed-in account, then the
 * owner's data is deleted (shared knowledge is kept) and the session ends. The client then goes
 * to /setup, because the account is gone too.
 */
export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readJson(req, bodySchema)
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { username: true, passwordHash: true } })
  if (normalizeUsername(body.name) !== row.username) throw new HttpError(400, 'The name does not match this account')
  if (!(await verifyPassword(row.passwordHash, body.password))) throw new HttpError(400, 'The password is not right')

  const report = await removeOwnerData()
  try {
    await signOut({ redirect: false })
  } catch {
    // The user row is gone, so the old cookie is refused everywhere anyway.
  }
  return ok(report, { message: 'Your data was removed' })
})
