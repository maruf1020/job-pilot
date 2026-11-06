import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ignoredCount, isAllowedUpdate, resetIgnored, updateChatId } from './access'
import { createBot } from './bot'
import type { TelegramClient } from './client'
import { createRegistry, defineCommand } from './registry'
import type { TgUpdate } from './types'

const OWNER = '4242'
const msg = (chat: number, text: string, extra: Partial<NonNullable<TgUpdate['message']>> = {}): TgUpdate => ({ update_id: 1, message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: chat }, from: { id: chat }, text, ...extra } })

function fakeClient(): TelegramClient & { sent: string[] } {
  const sent: string[] = []
  return {
    sent,
    sendMessage: vi.fn(async (_c, text) => (sent.push(text), { messageId: 1 })),
    answerCallbackQuery: vi.fn(async () => undefined),
    editMessageReplyMarkup: vi.fn(async () => undefined),
    getUpdates: vi.fn(async () => []),
    setMyCommands: vi.fn(async () => undefined),
    deleteWebhook: vi.fn(async () => undefined),
  }
}

describe('access control', () => {
  beforeEach(() => resetIgnored())

  it('only accepts the configured chat', () => {
    expect(isAllowedUpdate(msg(4242, '/status'), OWNER)).toBe(true)
    expect(isAllowedUpdate(msg(999, '/status'), OWNER)).toBe(false)
    expect(isAllowedUpdate(msg(4242, '/status'), '')).toBe(false)
    expect(isAllowedUpdate(msg(4242, '/status'), undefined)).toBe(false)
  })

  it('reads the chat of a button press from the message it sits on', () => {
    const cb: TgUpdate = { update_id: 2, callback_query: { id: 'x', from: { id: 999 }, data: 'c:abcd1234:y', message: { message_id: 3, date: 1, chat: { id: 999 } } } }
    expect(updateChatId(cb)).toBe('999')
    expect(isAllowedUpdate(cb, OWNER)).toBe(false)
  })

  it('never lets a bot account in, even from the right chat', () => {
    const u = msg(4242, '/status')
    u.message!.from = { id: 7, is_bot: true }
    expect(isAllowedUpdate(u, OWNER)).toBe(false)
  })

  it('ignores a stranger silently: no reply, no handler, only a count', async () => {
    const handler = vi.fn(async () => 'secret')
    const registry = createRegistry([defineCommand({ name: 'status', description: 'x', usage: '/status', group: 'Overview', risk: 'read', handler })])
    const client = fakeClient()
    const log = vi.fn()
    const bot = createBot({ client, registry, allowedChatId: OWNER, log })
    await bot.handleUpdate(msg(999, '/status'))
    await bot.handleUpdate(msg(999, 'hello'))
    expect(handler).not.toHaveBeenCalled()
    expect(client.sendMessage).not.toHaveBeenCalled()
    expect(client.answerCallbackQuery).not.toHaveBeenCalled()
    expect(ignoredCount()).toBe(2)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ignored 1 update'))
    // the owner still works
    await bot.handleUpdate(msg(4242, '/status'))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(client.sent).toEqual(['secret'])
  })
})
