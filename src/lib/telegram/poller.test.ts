import { describe, expect, it, vi } from 'vitest'
import { createTelegramClient, TelegramApiError, type TelegramClient } from './client'
import { backoffMs, runPoller } from './poller'
import type { OffsetStore } from './offset'
import type { TgUpdate } from './types'

const upd = (id: number): TgUpdate => ({ update_id: id })

function memoryOffsets(start = 0): OffsetStore & { value: number } {
  const s = { value: start, load: () => s.value, save: (n: number) => void (s.value = n) }
  return s
}

function client(getUpdates: TelegramClient['getUpdates']): TelegramClient {
  return {
    sendMessage: vi.fn(async () => ({ messageId: 1 })),
    answerCallbackQuery: vi.fn(async () => undefined),
    editMessageReplyMarkup: vi.fn(async () => undefined),
    getUpdates,
    setMyCommands: vi.fn(async () => undefined),
    deleteWebhook: vi.fn(async () => undefined),
  }
}

describe('poller', () => {
  it('sets the menu once, resumes from the saved offset and saves it after each update', async () => {
    const ac = new AbortController()
    const seen: number[] = []
    const offsets = memoryOffsets(40)
    let polls = 0
    const c = client(vi.fn(async (offset: number) => {
      polls++
      if (polls === 1) {
        expect(offset).toBe(40)
        return [upd(40), upd(41)]
      }
      ac.abort()
      return []
    }))
    await runPoller({ client: c, offsets, menu: [{ command: 'help', description: 'List commands' }], handleUpdate: async (u) => void seen.push(u.update_id), sleep: async () => undefined }, ac.signal)
    expect(seen).toEqual([40, 41])
    expect(offsets.value).toBe(42)
    expect(c.setMyCommands).toHaveBeenCalledTimes(1)
    expect(c.setMyCommands).toHaveBeenCalledWith([{ command: 'help', description: 'List commands' }])
    expect(c.deleteWebhook).toHaveBeenCalledTimes(1)
  })

  it('still moves the offset when a handler throws, so a crashing command is not replayed', async () => {
    const ac = new AbortController()
    const offsets = memoryOffsets()
    let polls = 0
    const c = client(async () => (++polls === 1 ? [upd(5)] : (ac.abort(), [])))
    const log = vi.fn()
    await runPoller({ client: c, offsets, menu: [], log, handleUpdate: async () => { throw new Error('boom') }, sleep: async () => undefined }, ac.signal)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'))
    expect(offsets.value).toBe(6)
  })

  it('backs off after failures and treats 409 as a long wait', async () => {
    const ac = new AbortController()
    const waits: number[] = []
    let polls = 0
    const c = client(async () => {
      polls++
      if (polls === 1) throw new TelegramApiError('getUpdates', 500, 'oops')
      if (polls === 2) throw new TelegramApiError('getUpdates', 500, 'oops')
      if (polls === 3) throw new TelegramApiError('getUpdates', 409, 'conflict')
      ac.abort()
      return []
    })
    await runPoller({ client: c, offsets: memoryOffsets(), menu: [], handleUpdate: async () => undefined, sleep: async (ms) => void waits.push(ms) }, ac.signal)
    expect(waits).toEqual([1000, 2000, 30_000])
  })

  it('caps the backoff', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000])
  })
})

describe('client never leaks the token', () => {
  it('scrubs the token from network and API errors', async () => {
    const token = '123456:SECRET-TOKEN-VALUE'
    const c = createTelegramClient({ token, fetchImpl: (async () => { throw new Error(`fetch failed for https://api.telegram.org/bot${token}/getUpdates`) }) as never })
    const err = await c.setMyCommands([]).catch((e) => e as Error)
    expect(err).toBeInstanceOf(TelegramApiError)
    expect((err as Error).message).not.toContain('SECRET-TOKEN-VALUE')
    const c2 = createTelegramClient({ token, fetchImpl: (async () => new Response(JSON.stringify({ ok: false, description: `bad ${token}` }), { status: 401 })) as never })
    const err2 = await c2.deleteWebhook().catch((e) => e as Error)
    expect((err2 as Error).message).not.toContain('SECRET-TOKEN-VALUE')
  })

  it('retries a message as plain text when Telegram cannot parse the formatting', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>
      bodies.push(body)
      if (body.parse_mode) return new Response(JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" }), { status: 400 })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200 })
    }) as never
    const c = createTelegramClient({ token: 't', fetchImpl })
    expect(await c.sendMessage('1', '**3 sent** a_b')).toEqual({ messageId: 9 })
    expect(bodies).toHaveLength(2)
    expect(bodies[1].text).toBe('3 sent a_b')
    expect(bodies[1].parse_mode).toBeUndefined()
  })
})
