import { COMMAND_GROUPS, defineCommand, type CommandRegistry } from '../registry'

/** /help text, generated from the registry so a new command shows up without touching this file. */
export function helpText(registry: CommandRegistry): string {
  const lines: string[] = ['**Commands**']
  for (const group of COMMAND_GROUPS) {
    const defs = registry.list().filter((d) => d.group === group)
    if (!defs.length) continue
    lines.push('', `**${group}**`)
    for (const d of defs) lines.push(`${d.usage} - ${d.description}${d.risk === 'outward' ? ' (asks Confirm)' : ''}`)
  }
  lines.push('', 'Any other message goes to /ai: ask about your data, or say what to do ("apply more"). Sending and other outward actions always ask Confirm first.')
  return lines.join('\n')
}

export const help = defineCommand({
  name: 'help',
  description: 'List every command with its usage',
  usage: '/help',
  group: 'Overview',
  risk: 'read',
  handler: async (ctx) => helpText(ctx.registry),
})
