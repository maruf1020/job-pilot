#!/usr/bin/env node
// Privacy gate for a shareable repo: scans every file git would publish (and the compressed
// knowledge pack, decompressed) for personal data.
//
//   npm run check:privacy
//
// 1. Generic rules: personal mailbox domains (gmail.com, outlook.com, ...) outside the fictional test
//    persona, and long international phone numbers.
// 2. An optional local denylist, `.privacy-denylist` (gitignored, never published): one word,
//    name, number or regex (/.../i) per line - for example your own name, phone and address before
//    you share a fork. Every hit is an error.
// Exit code 1 when anything is found.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '.next', '.next-e2e', 'storage', 'state', 'src/generated', 'playwright-report', 'test-results', '.git', 'e2e/.auth'])
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|mdx|yml|yaml|sql|prisma|css|html|txt|ps1|vbs|example|env|toml|ndjson)$/i

/** The fictional people used in tests and docs: allowed everywhere. */
// Plus two made-up free-mail addresses that tests need to prove personal mailboxes are held.
const ALLOWED = [/alex\.rivera@example\.com/i, /sam\.okafor@example\.com/i, /\+351 ?912 ?345 ?678/, /\+234 ?803 ?555 ?0199/, /\bsomeone@gmail\.com\b/i, /\brecruiter\+hof@protonmail\.ch\b/i]
const PERSONAL_MAIL = /[\w.+-]+@(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|proton|protonmail|gmx|yandex|aol)\.[a-z.]+/gi
const LONG_PHONE = /\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,5}\b/g

function listFiles() {
  try {
    // Files git would publish: tracked + untracked-but-not-ignored.
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return out.split('\n').filter(Boolean)
  } catch {
    const files = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${e.name}` : e.name
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(rel) && !SKIP_DIRS.has(e.name)) walk(rel)
        } else files.push(rel)
      }
    }
    walk('')
    return files
  }
}

function loadDenylist() {
  const file = path.join(ROOT, '.privacy-denylist')
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const m = l.match(/^\/(.+)\/([a-z]*)$/)
      if (m) return new RegExp(m[1], m[2].includes('g') ? m[2] : `${m[2]}g`)
      return new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    })
}

function readText(rel) {
  const abs = path.join(ROOT, rel)
  if (rel.endsWith('.gz')) return gunzipSync(fs.readFileSync(abs)).toString('utf8')
  if (!TEXT_EXT.test(rel) && !/(^|\/)(Dockerfile|LICENSE|\.gitignore|\.dockerignore)$/.test(rel)) return null
  const buf = fs.readFileSync(abs)
  if (buf.length > 20 * 1024 * 1024) return null
  return buf.toString('utf8')
}

const deny = loadDenylist()
const problems = []
const warnings = []
for (const rel of listFiles()) {
  if (rel === '.privacy-denylist' || rel === 'scripts/check-privacy.mjs') continue
  if (!fs.existsSync(path.join(ROOT, rel))) continue
  const text = readText(rel)
  if (text == null) continue
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    const where = `${rel}:${i + 1}`
    const allowed = (s) => ALLOWED.some((a) => a.test(s))
    for (const re of deny) {
      re.lastIndex = 0
      if (re.test(line)) problems.push(`${where}  denylist match ${re}`)
    }
    for (const m of line.matchAll(PERSONAL_MAIL)) if (!allowed(m[0])) problems.push(`${where}  personal mailbox ${m[0].replace(/^(.{3}).*@/, '$1...@')}`)
    for (const m of line.matchAll(LONG_PHONE)) if (!allowed(m[0]) && !/\d{4}-\d{2}-\d{2}/.test(m[0])) warnings.push(`${where}  phone-like number`)
  })
}

for (const w of warnings.slice(0, 50)) console.log(`warn  ${w}`)
if (warnings.length > 50) console.log(`warn  ... ${warnings.length - 50} more`)
for (const p of problems) console.log(`ERROR ${p}`)
console.log(`check:privacy: ${problems.length} problem(s), ${warnings.length} warning(s)${deny.length ? `, ${deny.length} denylist entries` : ' (no .privacy-denylist: generic rules only)'}`)
process.exit(problems.length ? 1 : 0)
