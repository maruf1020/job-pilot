import type { TgUpdate } from './types'

/**
 * Access control: only the chat in TELEGRAM_CHAT_ID is ever handled. Every other update (a stranger who
 * found the bot, a group it was added to) is dropped without an answer and only counted, so nobody can
 * even learn that the bot is a control panel.
 */

/** The chat the update comes from (a message, or the message a button was pressed on), as a string. */
export function updateChatId(update: TgUpdate): string | null {
  const chat = update.message?.chat ?? update.callback_query?.message?.chat
  return chat ? String(chat.id) : null
}

export function isAllowedUpdate(update: TgUpdate, allowedChatId: string | null | undefined): boolean {
  const allowed = (allowedChatId ?? '').trim()
  if (!allowed) return false
  const chatId = updateChatId(update)
  if (chatId === null || chatId !== allowed) return false
  const sender = update.message?.from ?? update.callback_query?.from
  if (sender?.is_bot) return false
  return true
}

let ignored = 0

/** Counts an ignored update; returns the total so far. */
export function noteIgnored(): number {
  return ++ignored
}

export function ignoredCount(): number {
  return ignored
}

/** For tests. */
export function resetIgnored(): void {
  ignored = 0
}
