import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard rails for the hosted deployment: nothing server-side may leak into the browser bundle.
 * - Client components ("use client") must not import the server env or read process.env.
 * - No NEXT_PUBLIC_ variable may carry a secret-looking name.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|mjs)$/.test(name) && !name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

const SRC = join(process.cwd(), 'src')

describe('secret hygiene', () => {
  it('client components never import server env or process.env', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      if (!/^['"]use client['"]/m.test(text)) continue
      if (/@\/lib\/env['"]/.test(text) || /process\.env\.(?!NEXT_PUBLIC_)/.test(text)) offenders.push(file.replace(process.cwd(), ''))
    }
    expect(offenders).toEqual([])
  })

  it('no NEXT_PUBLIC_ variable looks like a secret', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) if (/(SECRET|KEY|TOKEN|PASSWORD|PASS)\b/.test(m[0])) offenders.push(`${file.replace(process.cwd(), '')}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('example env files contain no filled-in secrets', () => {
    for (const f of ['.env.example', '.env.production.example']) {
      const text = readFileSync(join(process.cwd(), f), 'utf8')
      for (const line of text.split('\n')) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
        if (!m) continue
        if (/(SECRET|_KEY|TOKEN|PASSWORD|PASS)$/.test(m[1]) && m[2] && !/^(PASSWORD|USER|xxx|\$\{)/i.test(m[2])) throw new Error(`${f}: ${m[1]} has a value`)
      }
    }
  })
})
