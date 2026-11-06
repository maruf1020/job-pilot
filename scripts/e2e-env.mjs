#!/usr/bin/env node
// Runs a command against the end-to-end database and build, never the real ones:
// DATABASE_URL / DIRECT_DATABASE_URL point at <db>_e2e and NEXT_DIST_DIR at .next-e2e.
//
//   node scripts/e2e-env.mjs <command> [args...]
//
// E2E_DATABASE_URL overrides the derived URL. The command refuses to run unless the URL names a
// database ending in "_e2e", so a seed or a migration can never reach the real database by accident.
import { spawn } from 'node:child_process'

try {
  process.loadEnvFile('.env')
} catch {
  // the host may provide the environment
}

export function e2eDatabaseUrl(env = process.env) {
  if (env.E2E_DATABASE_URL) return env.E2E_DATABASE_URL
  const base = env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL is not set')
  const u = new URL(base)
  const name = u.pathname.replace(/^\//, '')
  if (!name.endsWith('_e2e')) u.pathname = `/${name}_e2e`
  return u.toString()
}

export function assertE2eUrl(url) {
  const name = new URL(url).pathname.replace(/^\//, '')
  if (!name.endsWith('_e2e')) throw new Error(`Refusing to run: the database "${name}" is not an e2e database`)
  return url
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (isMain) {
  const [cmd, ...args] = process.argv.slice(2)
  if (!cmd) {
    console.error('Usage: node scripts/e2e-env.mjs <command> [args...]')
    process.exit(2)
  }
  const url = assertE2eUrl(e2eDatabaseUrl())
  const env = { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url, NEXT_DIST_DIR: '.next-e2e', E2E: '1' }
  const child = spawn(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
}
