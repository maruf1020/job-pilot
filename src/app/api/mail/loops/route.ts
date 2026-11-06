import { open } from 'node:fs/promises'
import path from 'node:path'
import { ok, route } from '@/lib/api/response'
import { loopStatuses } from '@/lib/mail/loops'

const LOG_FILE = path.resolve(process.cwd(), 'storage', 'logs', 'supervisor-rounds.log')
/** The last 128 KB hold hours of rounds; the file itself only grows. */
const TAIL_BYTES = 128 * 1024

async function readTail(file: string): Promise<string> {
  const fh = await open(file, 'r')
  try {
    const { size } = await fh.stat()
    const length = Math.min(size, TAIL_BYTES)
    const buf = Buffer.alloc(length)
    await fh.read(buf, 0, length, size - length)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

/** GET /api/mail/loops -> last run, age and text of the 5, 15 and 30 minute supervisor loops. */
export const GET = route(async () => {
  const text = await readTail(LOG_FILE).catch(() => '') // No log yet: every loop shows as late.
  return ok({ loops: loopStatuses(text), now: new Date().toISOString() })
})
