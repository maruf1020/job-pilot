import type { BotCommandMenuItem } from './types'

/**
 * Typed command registry. Everything the bot can do is a command here: /help is generated from it, the
 * Telegram menu is filled from it, and free text can only ever be mapped to one of these names.
 *
 * Risk levels: read = looks only; action = changes this app's own state and is easy to undo (pause, resume,
 * queue a search); outward = can send email or is irreversible and always needs the Confirm button.
 */
export type Risk = 'read' | 'action' | 'outward'

export const COMMAND_GROUPS = ['Overview', 'Mail', 'Run', 'Control', 'Ask', 'Settings'] as const
export type CommandGroup = (typeof COMMAND_GROUPS)[number]

export interface ArgSpec {
  name: string
  required?: boolean
  /** Allowed values (the first word must be one of them). */
  choices?: readonly string[]
  /** Takes the rest of the message as one text. */
  rest?: boolean
}

export interface CommandContext {
  chatId: string
  /** Words after the command. */
  args: string[]
  /** The same, as one string. */
  rest: string
  source: 'command' | 'free-text' | 'confirm'
  registry: CommandRegistry
  /** Sends an extra message now (progress for slow commands). */
  reply: (text: string) => Promise<void>
  /** Runs another registry command the way a typed one runs (outward ones still ask for Confirm). */
  run: (name: string, args: string[], rest: string) => Promise<void>
  now: Date
}

export interface Preview {
  /** What the confirmation message says (numbers first). */
  text: string
  /** false: nothing to do, the text is the whole answer and no buttons are shown. */
  proceed: boolean
}

export interface CommandDef {
  /** Lowercase letters only, as Telegram wants for the menu. */
  name: string
  description: string
  /** Shown by /help, e.g. "/job <text>". */
  usage: string
  group: CommandGroup
  risk: Risk
  args?: readonly ArgSpec[]
  /** The text that goes back (empty: nothing more to send). For outward commands this runs only after the Confirm tap. */
  handler: (ctx: CommandContext) => Promise<string>
  /** Outward commands only: what would happen, with the count, shown above the Confirm / Cancel buttons. */
  preview?: (ctx: CommandContext) => Promise<Preview>
}

export interface CommandRegistry {
  get(name: string): CommandDef | undefined
  list(): CommandDef[]
  names(): string[]
  /** Entries for setMyCommands. */
  menu(): BotCommandMenuItem[]
}

const NAME_RE = /^[a-z]{2,32}$/

export function defineCommand(def: CommandDef): CommandDef {
  return def
}

export function createRegistry(defs: readonly CommandDef[]): CommandRegistry {
  const map = new Map<string, CommandDef>()
  for (const d of defs) {
    if (!NAME_RE.test(d.name)) throw new Error(`Invalid command name "${d.name}"`)
    if (map.has(d.name)) throw new Error(`Duplicate command name "${d.name}"`)
    if (d.risk === 'outward' && !d.preview) throw new Error(`Outward command "${d.name}" needs a preview for the Confirm step`)
    if (!d.usage.startsWith(`/${d.name}`)) throw new Error(`Usage of "${d.name}" must start with /${d.name}`)
    map.set(d.name, d)
  }
  return {
    get: (name) => map.get(name.toLowerCase()),
    list: () => [...map.values()],
    names: () => [...map.keys()],
    menu: () => [...map.values()].map((d) => ({ command: d.name, description: d.description.slice(0, 120) })),
  }
}

/** A one-line reason why the arguments do not fit, or null when they do. */
export function validateArgs(def: CommandDef, args: string[], rest: string): string | null {
  const specs = def.args ?? []
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]
    const value = spec.rest ? rest : args[i]
    if (!value) {
      if (spec.required) return `Missing ${spec.name}. Usage: ${def.usage}`
      continue
    }
    if (spec.choices && !spec.choices.includes(value.toLowerCase())) return `${spec.name} must be one of: ${spec.choices.join(', ')}. Usage: ${def.usage}`
  }
  return null
}

/** The commands whose name or description share the most words with the text (for "closest 3"). */
export function closestCommands(text: string, registry: CommandRegistry, count = 3): CommandDef[] {
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  )
  const scored = registry.list().map((d) => {
    const hay = `${d.name} ${d.description}`.toLowerCase()
    let score = 0
    for (const w of words) if (hay.includes(w)) score += d.name.includes(w) ? 3 : 1
    return { d, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, count).map((s) => s.d)
}
