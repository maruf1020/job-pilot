import { describe, expect, it } from 'vitest'
import { buildRegistry, COMMANDS } from './commands'
import { helpText } from './commands/help'
import { closestCommands, createRegistry, defineCommand, validateArgs } from './registry'

const noop = async () => ''
const def = (name: string, extra: Partial<Parameters<typeof defineCommand>[0]> = {}) => defineCommand({ name, description: 'd', usage: `/${name}`, group: 'Overview', risk: 'read', handler: noop, ...extra })

describe('command registry', () => {
  it('has unique, valid command names', () => {
    const names = COMMANDS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toMatch(/^[a-z]{2,32}$/)
    expect(() => createRegistry([def('dup'), def('dup')])).toThrow(/Duplicate/)
    expect(() => createRegistry([def('Bad1')])).toThrow(/Invalid/)
  })

  it('requires a preview for every outward command', () => {
    expect(() => createRegistry([def('boom', { risk: 'outward' })])).toThrow(/preview/)
    for (const c of COMMANDS.filter((x) => x.risk === 'outward')) expect(c.preview).toBeTypeOf('function')
    expect(COMMANDS.filter((c) => c.risk === 'outward').map((c) => c.name).sort()).toEqual(['sendnow', 'sendready'])
  })

  it('ships every command the bot is specified to have', () => {
    const names = buildRegistry().names()
    for (const n of ['help', 'status', 'todo', 'replies', 'mail', 'stats', 'loops', 'search', 'apply', 'applymore', 'pause', 'resume', 'sendnow', 'sendready', 'job', 'notify', 'whoami', 'ask', 'ai', 'metrics']) expect(names).toContain(n)
  })

  it('/help lists every registered command with its usage (registry-driven)', () => {
    const registry = buildRegistry()
    const text = helpText(registry)
    for (const c of registry.list()) expect(text).toContain(c.usage)
    // a command added later shows up without touching help.ts
    const extended = createRegistry([...COMMANDS, def('extra', { usage: '/extra <thing>' })])
    expect(helpText(extended)).toContain('/extra <thing>')
  })

  it('fills the Telegram menu from the registry', () => {
    const menu = buildRegistry().menu()
    expect(menu).toHaveLength(COMMANDS.length)
    for (const m of menu) {
      expect(m.command).toMatch(/^[a-z]+$/)
      expect(m.description.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('validates arguments against the spec', () => {
    const registry = buildRegistry()
    const notify = registry.get('notify')!
    expect(validateArgs(notify, [], '')).toMatch(/Missing/)
    expect(validateArgs(notify, ['maybe'], 'maybe')).toMatch(/one of/)
    expect(validateArgs(notify, ['ON'], 'ON')).toBeNull()
    expect(validateArgs(registry.get('job')!, [], '')).toMatch(/Missing/)
    expect(validateArgs(registry.get('job')!, ['acme'], 'acme')).toBeNull()
  })

  it('suggests the closest commands by words', () => {
    const near = closestCommands('please pause everything', buildRegistry(), 3).map((c) => c.name)
    expect(near[0]).toBe('pause')
    expect(near).toHaveLength(3)
  })
})
