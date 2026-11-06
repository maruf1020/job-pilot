import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api/response'

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    return ok({ status: 'ok', db: 'up', time: new Date().toISOString() })
  } catch (err) {
    return fail(503, `Database unreachable: ${err instanceof Error ? err.message : err}`)
  }
}
