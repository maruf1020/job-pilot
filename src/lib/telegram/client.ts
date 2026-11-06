import { getServiceCredential } from '@/lib/keys/service-keys'
import { lightMarkdownToV2, splitMessage, stripLightMarkdown } from './format'
import type { BotCommandMenuItem, InlineKeyboard, TgUpdate } from './types'

/** A Bot API failure. The message never contains the token. */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly description: string,
  ) {
    super(`Telegram ${method} failed (${status}): ${description}`)
    this.name = 'TelegramApiError'
  }
}

export interface SendOptions {
  /** Treat the text as light Markdown (**bold**, `code`); default true. */
  markdown?: boolean
  keyboard?: InlineKeyboard
}

export interface TelegramClient {
  sendMessage(chatId: string, text: string, opts?: SendOptions): Promise<{ messageId: number } | null>
  answerCallbackQuery(callbackId: string, text?: string): Promise<void>
  /** null removes the buttons. */
  editMessageReplyMarkup(chatId: string, messageId: number, keyboard: InlineKeyboard | null): Promise<void>
  getUpdates(offset: number, timeoutSec: number, signal?: AbortSignal): Promise<TgUpdate[]>
  setMyCommands(commands: BotCommandMenuItem[]): Promise<void>
  deleteWebhook(): Promise<void>
}

export interface ClientConfig {
  token: string
  fetchImpl?: typeof fetch
  baseUrl?: string
}

export async function telegramConfigured(): Promise<boolean> {
  return Boolean(await getServiceCredential('telegram'))
}

export function createTelegramClient(config: ClientConfig): TelegramClient {
  const { token } = config
  const doFetch = config.fetchImpl ?? fetch
  const base = (config.baseUrl ?? 'https://api.telegram.org').replace(/\/$/, '')
  // Network errors can echo the request URL; the token must never reach a log line or a chat.
  const scrub = (s: string) => (token ? s.split(token).join('<token>') : s)

  async function call<T>(method: string, body: Record<string, unknown>, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    const signals = [AbortSignal.timeout(opts.timeoutMs ?? 15_000), ...(opts.signal ? [opts.signal] : [])]
    let res: Response
    try {
      res = await doFetch(`${base}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any(signals),
      })
    } catch (err) {
      if (opts.signal?.aborted) throw err
      throw new TelegramApiError(method, 0, scrub(err instanceof Error ? err.message : String(err)))
    }
    let json: { ok?: boolean; result?: T; description?: string } = {}
    try {
      json = (await res.json()) as typeof json
    } catch {
      /* non-JSON answer */
    }
    if (!res.ok || !json.ok) throw new TelegramApiError(method, res.status, scrub(json.description ?? res.statusText ?? 'request failed'))
    return json.result as T
  }

  return {
    async sendMessage(chatId, text, opts = {}) {
      const markdown = opts.markdown !== false
      const parts = splitMessage(text)
      let last: { messageId: number } | null = null
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const markup = i === parts.length - 1 && opts.keyboard ? { reply_markup: { inline_keyboard: opts.keyboard } } : {}
        const common = { chat_id: chatId, disable_web_page_preview: true, ...markup }
        try {
          const r = await call<{ message_id: number }>('sendMessage', markdown ? { ...common, text: lightMarkdownToV2(part), parse_mode: 'MarkdownV2' } : { ...common, text: part })
          last = { messageId: r.message_id }
        } catch (err) {
          // A formatting problem must not lose the answer: send it as plain text.
          if (!(markdown && err instanceof TelegramApiError && err.status === 400 && /parse|entit/i.test(err.description))) throw err
          const r = await call<{ message_id: number }>('sendMessage', { ...common, text: stripLightMarkdown(part) })
          last = { messageId: r.message_id }
        }
      }
      return last
    },
    async answerCallbackQuery(callbackId, text) {
      await call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text: text.slice(0, 190) } : {}) })
    },
    async editMessageReplyMarkup(chatId, messageId, keyboard) {
      await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard ?? [] } })
    },
    async getUpdates(offset, timeoutSec, signal) {
      return call<TgUpdate[]>('getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] }, { signal, timeoutMs: (timeoutSec + 15) * 1000 })
    },
    async setMyCommands(commands) {
      await call('setMyCommands', { commands })
    },
    async deleteWebhook() {
      await call('deleteWebhook', { drop_pending_updates: false })
    },
  }
}

/** The client for this app's bot, or null when the token or chat id is missing. */
export async function clientFromEnv(): Promise<TelegramClient | null> {
  const tg = await getServiceCredential('telegram')
  return tg ? createTelegramClient({ token: tg.TELEGRAM_BOT_TOKEN }) : null
}
