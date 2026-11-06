import { defaultAgentDeps, renderAnswer, runAgent } from '../ai/agent'
import { defineCommand, type CommandContext } from '../registry'
import { getTimezone } from '../tz'

/** Shared by /ai and /ask: runs the agent and either answers or hands an action to the command registry. */
async function answer(ctx: CommandContext, metricsOnly: boolean): Promise<string> {
  const showSql = !metricsOnly && ctx.args[0] === '--sql'
  const question = showSql ? ctx.args.slice(1).join(' ') : ctx.rest
  if (!question.trim()) return metricsOnly ? 'Usage: /ask <question>. See /metrics for examples.' : 'Usage: /ai [--sql] <question>. Example: /ai how many jobs scored 70+ this week?'
  const outcome = await runAgent(question, defaultAgentDeps(ctx.registry, { metricsOnly, timezone: await getTimezone() }))
  if (outcome.kind === 'command') {
    await ctx.reply(`Understood as /${outcome.name}${outcome.rest ? ` ${outcome.rest}` : ''}.`)
    await ctx.run(outcome.name, outcome.args, outcome.rest)
    return ''
  }
  return renderAnswer(outcome, showSql)
}

export const ai = defineCommand({
  name: 'ai',
  description: 'Ask anything about your data (read-only); add --sql to see the query. Plain text does the same',
  usage: '/ai [--sql] <question>',
  group: 'Ask',
  risk: 'read',
  args: [{ name: 'question', required: true, rest: true }],
  handler: (ctx) => answer(ctx, false),
})

export const ask = defineCommand({
  name: 'ask',
  description: 'Quick numbers from the fixed list of metrics (see /metrics)',
  usage: '/ask <question>',
  group: 'Ask',
  risk: 'read',
  args: [{ name: 'question', required: true, rest: true }],
  handler: (ctx) => answer(ctx, true),
})
