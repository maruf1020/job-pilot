import { describe, expect, it, vi } from 'vitest'
import { createBot } from './bot'
import type { TelegramClient } from './client'
import { callbackData, CONFIRM_TTL_MS, ConfirmStore, parseCallbackData } from './confirm'
import { createRegistry, defineCommand } from './registry'
import type { TgUpdate } from './types'

describe('ConfirmStore', () => {
  it('confirms once and answers "already" on a repeated tap', () => {
    let t = 1_000
    const store = new ConfirmStore(CONFIRM_TTL_MS, () => t)
    const p = store.create('1', 'sendnow', [], '')
    expect(store.resolve(p.id, '1', 'confirm').status).toBe('confirmed')
    expect(store.resolve(p.id, '1', 'confirm').status).toBe('already')
    expect(store.resolve(p.id, '1', 'cancel').status).toBe('already')
    t += 10
  })

  it('expires after 3 minutes', () => {
    let t = 0
    const store = new ConfirmStore(CONFIRM_TTL_MS, () => t)
    const p = store.create('1', 'sendready', [], '')
    t = CONFIRM_TTL_MS - 1
    expect(store.pendingFor('1')?.id).toBe(p.id)
    t = CONFIRM_TTL_MS + 1
    expect(store.pendingFor('1')).toBeUndefined()
    expect(store.resolve(p.id, '1', 'confirm').status).toBe('expired')
    expect(store.resolve(p.id, '1', 'confirm').status).toBe('expired')
  })

  it('keeps one pending action per chat: a new one cancels the old', () => {
    const store = new ConfirmStore()
    const a = store.create('1', 'sendnow', [], '')
    const b = store.create('1', 'sendready', [], '')
    expect(store.resolve(a.id, '1', 'confirm').status).toBe('already')
    expect(store.resolve(b.id, '1', 'confirm').status).toBe('confirmed')
  })

  it('does not let another chat press the button, and knows nothing about random ids', () => {
    const store = new ConfirmStore()
    const p = store.create('1', 'sendnow', [], '')
    expect(store.resolve(p.id, '2', 'confirm').status).toBe('unknown')
    expect(store.resolve('deadbeef', '1', 'confirm').status).toBe('unknown')
    expect(store.resolve(p.id, '1', 'cancel').status).toBe('cancelled')
  })

  it('round-trips callback data within Telegram limits', () => {
    const id = 'a1b2c3d4'
    expect(parseCallbackData(callbackData(id, 'confirm'))).toEqual({ id, decision: 'confirm' })
    expect(parseCallbackData(callbackData(id, 'cancel'))).toEqual({ id, decision: 'cancel' })
    expect(callbackData(id, 'confirm').length).toBeLessThan(64)
    expect(parseCallbackData('c:zz:y')).toBeNull()
    expect(parseCallbackData(undefined)).toBeNull()
  })
})

const OWNER = '4242'
function setup() {
  const sent: Array<{ text: string; keyboard?: unknown }> = []
  const client: TelegramClient = {
    sendMessage: vi.fn(async (_c, text, opts) => (sent.push({ text, keyboard: opts?.keyboard }), { messageId: 10 })),
    answerCallbackQuery: vi.fn(async () => undefined),
    editMessageReplyMarkup: vi.fn(async () => undefined),
    getUpdates: vi.fn(async () => []),
    setMyCommands: vi.fn(async () => undefined),
    deleteWebhook: vi.fn(async () => undefined),
  }
  const handler = vi.fn(async () => 'Sent 3 emails.')
  const registry = createRegistry([defineCommand({ name: 'sendnow', description: 'x', usage: '/sendnow', group: 'Mail', risk: 'outward', preview: async () => ({ text: '**3 emails** would go out', proceed: true }), handler })])
  let now = Date.now()
  const bot = createBot({ client, registry, allowedChatId: OWNER, now: () => new Date(now), store: new ConfirmStore(CONFIRM_TTL_MS, () => now) })
  const text = (t: string): TgUpdate => ({ update_id: 1, message: { message_id: 1, date: Math.floor(now / 1000), chat: { id: 4242 }, from: { id: 4242 }, text: t } })
  const tap = (data: string): TgUpdate => ({ update_id: 2, callback_query: { id: 'cb', from: { id: 4242 }, data, message: { message_id: 10, date: Math.floor(now / 1000), chat: { id: 4242 } } } })
  return { bot, client, sent, handler, text, tap, advance: (ms: number) => (now += ms) }
}

describe('outward commands need the Confirm button', () => {
  it('shows the preview with buttons and does nothing until Confirm', async () => {
    const s = setup()
    await s.bot.handleUpdate(s.text('/sendnow'))
    expect(s.handler).not.toHaveBeenCalled()
    expect(s.sent[0].text).toContain('3 emails')
    expect(JSON.stringify(s.sent[0].keyboard)).toContain('Confirm')
    const id = s.bot.store.pendingFor(OWNER)!.id
    await s.bot.handleUpdate(s.tap(callbackData(id, 'confirm')))
    expect(s.handler).toHaveBeenCalledTimes(1)
    expect(s.sent.at(-1)!.text).toBe('Sent 3 emails.')
  })

  it('runs the action only once when the button is tapped twice', async () => {
    const s = setup()
    await s.bot.handleUpdate(s.text('/sendnow'))
    const id = s.bot.store.pendingFor(OWNER)!.id
    await s.bot.handleUpdate(s.tap(callbackData(id, 'confirm')))
    await s.bot.handleUpdate(s.tap(callbackData(id, 'confirm')))
    expect(s.handler).toHaveBeenCalledTimes(1)
  })

  it('Cancel and expiry never run the action', async () => {
    const s = setup()
    await s.bot.handleUpdate(s.text('/sendnow'))
    const id = s.bot.store.pendingFor(OWNER)!.id
    await s.bot.handleUpdate(s.tap(callbackData(id, 'cancel')))
    expect(s.handler).not.toHaveBeenCalled()
    await s.bot.handleUpdate(s.text('/sendnow'))
    const id2 = s.bot.store.pendingFor(OWNER)!.id
    s.advance(CONFIRM_TTL_MS + 1000)
    await s.bot.handleUpdate(s.tap(callbackData(id2, 'confirm')))
    expect(s.handler).not.toHaveBeenCalled()
    expect(s.sent.at(-1)!.text).toMatch(/expired/i)
  })
})
