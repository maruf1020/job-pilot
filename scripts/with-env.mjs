#!/usr/bin/env node
/**
 * Run a command with the variables from an env file (values in the file win).
 *   node scripts/with-env.mjs .env.production.local -- npx prisma migrate deploy
 * Used by the prod:* npm scripts so migrations/seeds/studio target the hosted database
 * without touching .env.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

const [file, sep, ...cmd] = process.argv.slice(2)
if (!file || sep !== '--' || cmd.length === 0) {
  console.error('usage: node scripts/with-env.mjs <env-file> -- <command...>')
  process.exit(2)
}
if (!existsSync(file)) {
  console.error(`${file} not found. Copy .env.production.example to ${file} and fill it in.`)
  process.exit(2)
}
const vars = parseEnv(readFileSync(file, 'utf8'))
for (const k of Object.keys(vars)) if (vars[k] === '') delete vars[k]
// Tell our own loaders not to layer .env on top.
const env = { ...process.env, ...vars, SKIP_DOTENV: '1' }
const target = env.DIRECT_DATABASE_URL ?? env.DATABASE_URL ?? ''
console.log(`[with-env] ${file} → ${cmd.join(' ')}${target ? `  (db host: ${safeHost(target)})` : ''}`)
// One command string through the shell (npx/prisma need PATH resolution on Windows and Linux alike).
const child = spawn(cmd.join(' '), { stdio: 'inherit', shell: true, env })
child.on('exit', (code) => process.exit(code ?? 1))

function safeHost(url) {
  try {
    return new URL(url).host
  } catch {
    return '?'
  }
}
