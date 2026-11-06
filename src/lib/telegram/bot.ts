import { isAllowedUpdate, noteIgnored } from './access'
import type { TelegramClient } from './client'
import { confirmKeyboard, ConfirmStore, parseCallbackData } from './confirm'
import { oneLineError } from './format'
import { parseMessage } from './router'
import { closestCommands, validateArgs, type CommandContext, type CommandDef, type CommandRegistry } from './registry'
import type { TgUpdate } from './types'

/** Messages older than this are not acted on (a backlog from while the worker was down must not run commands). */
export const MAX_MESSAGE_AGE_SEC = 5 * 60

export interface BotDeps {
  client: TelegramClient
  registry: CommandRegistry
  /** TELEGRAM_CHAT_ID: the only chat the bot answers. */
  allowedChatId: string
  store?: ConfirmStore
  botUsername?: string | null
  now?: () => Date
  maxAgeSec?: number
  log?: (message: string) => void
}

export interface Bot {
  handleUpdate(update: TgUpdate): Promise<void>
  store: ConfirmStore
}

export function createBot(deps: BotDeps): Bot {
  const { client, registry, allowedChatId } = deps
  const store = deps.store ?? new ConfirmStore()
  const now = deps.now ?? (() => new Date())
  const maxAge = deps.maxAgeSec ?? MAX_MESSAGE_AGE_SEC
  const log = deps.log ?? (() => undefined)
  const chatId = allowedChatId

  const send = async (text: string) => {
    await client.sendMessage(chatId, text).catch((err) => log(`send failed: ${oneLineError(err)}`))
  }

  async function execute(def: CommandDef, args: string[], rest: string, source: CommandContext['source']): Promise<void> {
    const problem = validateArgs(def, args, rest)
    if (problem) return send(problem)
    const ctx: CommandContext = { chatId, args, rest, source, registry, now: now(), reply: send, run: (name, a, r) => runByName(name, a, r, 'free-text') }
    try {
      if (def.risk === 'outward' && source !== 'confirm') {
        const preview = await def.preview!(ctx)
        if (!preview.proceed) return send(preview.text)
        const pending = store.create(chatId, def.name, args, rest)
        const sent = await client.sendMessage(chatId, `${preview.text}\n\nTap Confirm within 3 minutes. Nothing happens until you do.`, { keyboard: confirmKeyboard(pending.id) })
        if (sent) store.attachMessage(pending.id, sent.messageId)
        return
      }
      const text = await def.handler(ctx)
      if (text) await send(text)
    } catch (err) {
      log(`/${def.name} failed: ${oneLineError(err)}`)
      await send(`/${def.name} failed: ${oneLineError(err)}`)
    }
  }

  /** Runs a registry command by name (used for actions that /ai or free text mapped to a command). */
  async function runByName(name: string, args: string[], rest: string, source: CommandContext['source']): Promise<void> {
    const def = registry.get(name)
    if (!def) return send(`Unknown command /${name}. Send /help for the list.`)
    return execute(def, args, rest, source)
  }

  async function handleCallback(update: TgUpdate): Promise<void> {
    const cb = update.callback_query!
    const parsed = parseCallbackData(cb.data)
    const messageId = cb.message?.message_id
    const clearButtons = () => (messageId ? client.editMessageReplyMarkup(chatId, messageId, null).catch(() => undefined) : Promise.resolve())
    if (!parsed) return void (await client.answerCallbackQuery(cb.id).catch(() => undefined))
    const res = store.resolve(parsed.id, chatId, parsed.decision)
    switch (res.status) {
      case 'confirmed': {
        await client.answerCallbackQuery(cb.id, 'Confirmed').catch(() => undefined)
        await clearButtons()
        const def = registry.get(res.pending!.command)
        if (!def) return send('That command no longer exists.')
        return execute(def, res.pending!.args, res.pending!.rest, 'confirm')
      }
      case 'cancelled':
        await client.answerCallbackQuery(cb.id, 'Cancelled').catch(() => undefined)
        await clearButtons()
        return send('Cancelled. Nothing was changed or sent.')
      case 'expired':
        await client.answerCallbackQuery(cb.id, 'Expired').catch(() => undefined)
        await clearButtons()
        return send('That confirmation expired after 3 minutes. Send the command again if you still want it.')
      case 'already':
        return void (await client.answerCallbackQuery(cb.id, 'Already handled').catch(() => undefined))
      default:
        await client.answerCallbackQuery(cb.id, 'No longer active').catch(() => undefined)
        await clearButtons()
    }
  }

  async function handleMessage(update: TgUpdate): Promise<void> {
    const msg = update.message!
    if (now().getTime() / 1000 - msg.date > maxAge) return void log('ignored an old message (older than 5 minutes)')
    const parsed = parseMessage(msg.text, deps.botUsername)
    if (parsed.kind === 'empty' || parsed.kind === 'other-bot') return
    if (parsed.kind === 'command') {
      const def = registry.get(parsed.name)
      if (!def) {
        const near = closestCommands(parsed.name, registry, 3)
        return send(`Unknown command /${parsed.name.slice(0, 30)}. Closest: ${near.map((c) => `/${c.name}`).join(', ')}. Send /help for all.`)
      }
      return execute(def, parsed.args, parsed.rest, 'command')
    }
    // Plain text goes through the same path as /ai: a metric, a read-only query, or a registry command.
    const ai = registry.get('ai')
    if (!ai) return send('Send /help for the list of commands.')
    return execute(ai, parsed.text.split(/\s+/), parsed.text, 'free-text')
  }

  return {
    store,
    async handleUpdate(update) {
      if (!isAllowedUpdate(update, allowedChatId)) {
        const n = noteIgnored()
        // Never answer; count, and log the first and then every 10th so a flood stays readable.
        if (n === 1 || n % 10 === 0) log(`ignored ${n} update(s) from other chats`)
        return
      }
      try {
        if (update.callback_query) await handleCallback(update)
        else if (update.message?.text !== undefined) await handleMessage(update)
      } catch (err) {
        log(`update ${update.update_id} failed: ${oneLineError(err)}`)
      }
    },
  }
}
