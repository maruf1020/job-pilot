#!/usr/bin/env node
// Keeps the worker running: starts `tsx src/worker/start.ts` with WORKER_ROLE, restarts it when it
// exits (5 s, doubling to 60 s; back to 5 s after 10 minutes up), appends its output to
// storage/logs/worker-<role>-<YYYYMMDD>.log and pushes one phone notice (NTFY_TOPIC or Telegram,
// from .env) when it had to restart 3 or more times within 10 minutes.
//
//   node scripts/workers.mjs [all|search|apply]      (or WORKER_ROLE=...)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
try {
  process.loadEnvFile(path.join(ROOT, '.env'))
} catch {
  // .env is optional when the host provides the environment
}

const ROLES = ['all', 'search', 'apply']
const arg = (process.argv[2] ?? process.env.WORKER_ROLE ?? 'all').trim().toLowerCase()
if (!ROLES.includes(arg)) {
  console.error(`Unknown role "${arg}". Use one of: ${ROLES.join(', ')}`)
  process.exit(2)
}
const ROLE = arg
const MIN_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 60_000
const HEALTHY_AFTER_MS = 10 * 60_000
const ALERT_WINDOW_MS = 10 * 60_000
const ALERT_RESTARTS = 3
const ALERT_QUIET_MS = 30 * 60_000
const LOG_DIR = path.join(ROOT, 'storage', 'logs')
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')

fs.mkdirSync(LOG_DIR, { recursive: true })

// One supervisor per side: two apply workers each kept their own list of open form tabs, so tabs
// piled up in the user's Chrome and a restart of one marked the other's running attempts as failed.
// "all" holds both sides.
const LOCK_DIR = path.join(ROOT, 'storage', 'locks')
const SIDES = ROLE === 'all' ? ['search', 'apply'] : [ROLE]
const lockFile = (side) => path.join(LOCK_DIR, `worker-${side}.pid`)
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}
fs.mkdirSync(LOCK_DIR, { recursive: true })
for (const side of SIDES) {
  const pid = Number(fs.existsSync(lockFile(side)) ? fs.readFileSync(lockFile(side), 'utf8').trim() : 0)
  if (pid && pid !== process.pid && alive(pid)) {
    console.error(`${side === "apply" ? "An" : "A"} ${side} worker supervisor already runs (pid ${pid}); not starting a second one. Stop it first, or restart only its worker process.`)
    process.exit(3)
  }
}
for (const side of SIDES) fs.writeFileSync(lockFile(side), String(process.pid))
process.on('exit', () => {
  for (const side of SIDES) {
    try {
      if (fs.readFileSync(lockFile(side), 'utf8').trim() === String(process.pid)) fs.unlinkSync(lockFile(side))
    } catch {
      // already gone
    }
  }
})

function logFile() {
  const d = new Date()
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return path.join(LOG_DIR, `worker-${ROLE}-${day}.log`)
}

function write(chunk) {
  try {
    fs.appendFileSync(logFile(), chunk)
  } catch {
    // a full disk must not kill the supervisor
  }
}

function note(message) {
  const line = `[workers:${ROLE}] ${new Date().toISOString()} ${message}\n`
  process.stdout.write(line)
  write(line)
}

async function push(title, body) {
  try {
    if (process.env.NTFY_TOPIC) {
      const server = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '')
      await fetch(server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.NTFY_TOKEN ? { Authorization: `Bearer ${process.env.NTFY_TOKEN}` } : {}) },
        body: JSON.stringify({ topic: process.env.NTFY_TOPIC, title, message: body, priority: 4, tags: ['warning'] }),
        signal: AbortSignal.timeout(15_000),
      })
    } else if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: `${title}\n\n${body}` }),
        signal: AbortSignal.timeout(15_000),
      })
    }
  } catch (err) {
    note(`phone notice failed: ${err instanceof Error ? err.message : err}`)
  }
}

let child = null
let stopping = false
let backoff = MIN_BACKOFF_MS
let lastAlertAt = 0
const restarts = []

function start() {
  const startedAt = Date.now()
  note(`starting worker (role ${ROLE})`)
  child = spawn(process.execPath, [TSX, 'src/worker/start.ts'], {
    cwd: ROOT,
    env: { ...process.env, WORKER_ROLE: ROLE },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.on('data', (c) => {
    process.stdout.write(c)
    write(c)
  })
  child.stderr.on('data', (c) => {
    process.stderr.write(c)
    write(c)
  })
  child.on('error', (err) => note(`could not start: ${err.message}`))
  child.on('exit', (code, signal) => {
    child = null
    if (stopping) return
    const upMs = Date.now() - startedAt
    if (upMs >= HEALTHY_AFTER_MS) backoff = MIN_BACKOFF_MS
    const now = Date.now()
    restarts.push(now)
    while (restarts.length && now - restarts[0] > ALERT_WINDOW_MS) restarts.shift()
    note(`worker exited (code ${code ?? '-'}${signal ? `, signal ${signal}` : ''}) after ${Math.round(upMs / 1000)} s; restarting in ${Math.round(backoff / 1000)} s`)
    if (restarts.length >= ALERT_RESTARTS && now - lastAlertAt > ALERT_QUIET_MS) {
      lastAlertAt = now
      void push(`Job finder worker (${ROLE}) keeps crashing`, `It restarted ${restarts.length} times in the last 10 minutes. Last exit code ${code ?? '-'}. See storage/logs/${path.basename(logFile())}.`)
    }
    const wait = backoff
    backoff = Math.min(MAX_BACKOFF_MS, backoff * 2)
    setTimeout(() => {
      if (!stopping) start()
    }, wait)
  })
}

function stop(signal) {
  if (stopping) return
  stopping = true
  note(`${signal} received, stopping the worker`)
  if (!child) process.exit(0)
  child.once('exit', () => process.exit(0))
  child.kill(signal)
  // Windows cannot deliver SIGINT/SIGTERM gracefully to a child: give it a moment, then end it.
  setTimeout(() => {
    child?.kill('SIGKILL')
    process.exit(0)
  }, 40_000).unref()
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
start()
