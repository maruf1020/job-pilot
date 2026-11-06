import { execFile } from 'node:child_process'
import path from 'node:path'

/**
 * Keeps the search and apply workers running while `npm run dev` runs: scripts/ensure-workers.mjs every
 * 5 minutes starts whichever is down, so `npm run dev` alone runs everything, even after a blue screen
 * (one once left both workers stopped for hours). Running workers are left alone.
 * Node-only, so it lives outside instrumentation.ts (Next.js also compiles that file for the Edge runtime).
 */
const g = globalThis as typeof globalThis & { __workerWatch?: NodeJS.Timeout }

if (!g.__workerWatch) {
  const script = path.join(process.cwd(), 'scripts', 'ensure-workers.mjs')
  const check = () => execFile(process.execPath, [script, '--quiet'], { cwd: process.cwd(), windowsHide: true, timeout: 90_000 }, () => undefined)
  g.__workerWatch = setInterval(check, 5 * 60_000)
  g.__workerWatch.unref()
}
