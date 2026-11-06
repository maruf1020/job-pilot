#!/usr/bin/env node
// Prepares the end-to-end environment: creates the <db>_e2e database when missing, applies the
// migrations, seeds it (settings, knowledge, an e2e owner + profile, demo data) and builds the app into .next-e2e.
// The real database and the .next folder of a running `next dev` are never touched.
//
//   node scripts/e2e-prepare.mjs [--no-build] [--reset]
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { assertE2eUrl, e2eDatabaseUrl } from './e2e-env.mjs'

try {
  process.loadEnvFile('.env')
} catch {
  // the host may provide the environment
}

const url = assertE2eUrl(e2eDatabaseUrl())
const dbName = new URL(url).pathname.replace(/^\//, '')
const reset = process.argv.includes('--reset')
const build = !process.argv.includes('--no-build')

const admin = new URL(url)
admin.pathname = '/postgres'
admin.search = ''
const client = new pg.Client({ connectionString: admin.toString() })
await client.connect()
const exists = (await client.query('select 1 from pg_database where datname = $1', [dbName])).rowCount > 0
if (exists && reset) {
  await client.query(`drop database "${dbName}" with (force)`)
  console.log(`dropped ${dbName}`)
}
if (!exists || reset) {
  await client.query(`create database "${dbName}"`)
  console.log(`created ${dbName}`)
} else console.log(`${dbName} exists`)
await client.end()

const env = { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url, NEXT_DIST_DIR: '.next-e2e', E2E: '1' }
const run = (cmd, args) => {
  console.log(`> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
run('npx', ['prisma', 'migrate', 'deploy'])
run('npx', ['tsx', 'prisma/seed.ts'])
run('npx', ['tsx', 'scripts/seed-demo.ts'])
run('npx', ['tsx', 'scripts/seed-e2e.ts'])
// webpack, not Turbopack: Turbopack's file tracing reads every file in the project, and the running
// apply browser keeps files in storage/ locked, which failed the build (os error 33).
if (build) run('npx', ['next', 'build', '--webpack'])
console.log('e2e environment ready: npm run test:e2e')
