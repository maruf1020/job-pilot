#!/usr/bin/env node
/**
 * Copy the local Docker database to the hosted one (or back it up).
 *
 *   node scripts/db-copy.mjs dump                       → storage/backups/<timestamp>.dump
 *   node scripts/db-copy.mjs restore --yes [--file f]   → restores into DIRECT_DATABASE_URL
 *                                                          from .env.production.local
 *
 * Both steps run pg_dump / pg_restore inside the local "postgres" compose container, so
 * no Postgres client needs to be installed on this machine. The dump contains the public
 * schema (all tables, including _prisma_migrations, so `prisma migrate deploy` afterwards
 * only applies newer migrations). The pgboss queue schema is not copied.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

const args = process.argv.slice(2)
const cmd = args[0]
const flag = (name) => args.includes(name)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function loadEnv(file) {
  if (!existsSync(file)) return {}
  return parseEnv(readFileSync(file, 'utf8'))
}

const local = loadEnv('.env')
const user = local.POSTGRES_USER ?? 'jobpilot'
const dbName = local.POSTGRES_DB ?? 'job_pilot'
const backupsDir = 'storage/backups'

function compose(...a) {
  return execFileSync('docker', ['compose', ...a], { stdio: ['ignore', 'pipe', 'inherit'] }).toString()
}

if (cmd === 'dump') {
  mkdirSync(backupsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const out = `${backupsDir}/${stamp}.dump`
  console.log(`[db-copy] dumping ${dbName} from the local container…`)
  compose('exec', '-T', 'postgres', 'pg_dump', '-U', user, '-d', dbName, '-Fc', '--no-owner', '--no-privileges', '--schema=public', '-f', '/tmp/job-pilot.dump')
  compose('cp', 'postgres:/tmp/job-pilot.dump', out)
  console.log(`[db-copy] written ${out}`)
  process.exit(0)
}

if (cmd === 'restore') {
  const prod = loadEnv('.env.production.local')
  const url = prod.DIRECT_DATABASE_URL || prod.DATABASE_URL
  if (!url) {
    console.error('[db-copy] .env.production.local must contain DIRECT_DATABASE_URL (or DATABASE_URL)')
    process.exit(2)
  }
  let host = '?'
  try {
    host = new URL(url).host
  } catch {
    /* ignore */
  }
  const file =
    opt('--file') ??
    (existsSync(backupsDir)
      ? readdirSync(backupsDir)
          .filter((f) => f.endsWith('.dump'))
          .sort()
          .map((f) => `${backupsDir}/${f}`)
          .pop()
      : undefined)
  if (!file || !existsSync(file)) {
    console.error('[db-copy] no dump found; run "npm run db:dump" first or pass --file <path>')
    process.exit(2)
  }
  if (!flag('--yes')) {
    console.error(`[db-copy] This REPLACES all tables in ${host} with ${file}. Re-run with --yes to proceed.`)
    process.exit(2)
  }
  console.log(`[db-copy] restoring ${file} into ${host} …`)
  compose('cp', file, 'postgres:/tmp/restore.dump')
  try {
    execFileSync(
      'docker',
      ['compose', 'exec', '-T', 'postgres', 'pg_restore', '--no-owner', '--no-privileges', '--clean', '--if-exists', '--no-comments', '-d', url, '/tmp/restore.dump'],
      { stdio: 'inherit' },
    )
  } catch (err) {
    // pg_restore exits 1 on non-fatal notices (e.g. "schema public already exists"); the data is in.
    console.warn(`[db-copy] pg_restore reported warnings (exit ${err.status ?? '?'}); check the output above. "already exists" notices are harmless.`)
  }
  console.log('[db-copy] done. Now run "npm run prod:migrate" to apply any migrations newer than the dump.')
  process.exit(0)
}

console.error('usage: node scripts/db-copy.mjs dump | restore --yes [--file <dump>]')
process.exit(2)
