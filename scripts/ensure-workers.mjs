#!/usr/bin/env node
// Starts the search and apply worker supervisors that are not running, and leaves running ones alone.
// `npm run dev` runs it first (predev), and the dev server runs it again every 5 minutes
// (src/instrumentation.ts), so the workers start with the app and come back after a crash or a
// Windows restart (a blue screen once stopped both for hours). Set NO_WORKERS=1 to skip.
//
// Windows: scripts/ops/ensure-workers.ps1 (supervisors created through WMI, so closing the terminal
// or stopping the dev server never takes them down). Elsewhere: detached child processes.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const quiet = process.argv.includes('--quiet')
const say = (msg) => {
  if (!quiet) console.log(`[workers] ${msg}`)
}

if (process.env.NO_WORKERS === '1') {
  say('NO_WORKERS=1: not starting the workers')
  process.exit(0)
}

if (process.platform === 'win32') {
  const script = path.join(ROOT, 'scripts', 'ops', 'ensure-workers.ps1')
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { cwd: ROOT, stdio: 'ignore', windowsHide: true, timeout: 60_000 })
  if (r.status !== 0) say(`could not check the workers (exit ${r.status ?? r.error?.message}); see storage/logs/ensure-workers.log`)
  else say('search and apply workers are running (storage/logs/ensure-workers.log says what was started)')
  process.exit(0)
}

const lockDir = path.join(ROOT, 'storage', 'locks')
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}
for (const role of ['search', 'apply']) {
  const lock = path.join(lockDir, `worker-${role}.pid`)
  const pid = Number(fs.existsSync(lock) ? fs.readFileSync(lock, 'utf8').trim() : 0)
  if (pid && alive(pid)) continue
  if (fs.existsSync(lock)) fs.rmSync(lock, { force: true })
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'workers.mjs'), role], { cwd: ROOT, detached: true, stdio: 'ignore' })
  child.unref()
  say(`started the ${role} worker (pid ${child.pid})`)
}
