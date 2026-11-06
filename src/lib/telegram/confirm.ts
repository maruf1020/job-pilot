import { randomBytes } from 'node:crypto'
import type { InlineKeyboard } from './types'

/**
 * Confirm / Cancel for outward actions. One pending action per chat (a new one replaces the old), valid for
 * 3 minutes, and every id can be decided once: a second tap on the same button (Telegram retries, a double
 * tap) gets "already done" and never runs the action twice. In memory on purpose: after a restart an old
 * button simply reads as expired, which is the safe direction.
 */

export const CONFIRM_TTL_MS = 3 * 60_000
/** How long a decided id is remembered so repeated taps stay idempotent. */
const DONE_KEEP_MS = 60 * 60_000

export interface PendingAction {
  id: string
  chatId: string
  command: string
  args: string[]
  rest: string
  createdAt: number
  expiresAt: number
  /** Message that carries the buttons, so they can be removed afterwards. */
  messageId?: number
}

export type ResolveStatus = 'confirmed' | 'cancelled' | 'expired' | 'already' | 'unknown'

export interface ResolveResult {
  status: ResolveStatus
  pending?: PendingAction
}

export class ConfirmStore {
  private pending = new Map<string, PendingAction>()
  private byChat = new Map<string, string>()
  private done = new Map<string, { at: number; outcome: 'confirmed' | 'cancelled' | 'expired' }>()

  constructor(
    private readonly ttlMs = CONFIRM_TTL_MS,
    private readonly clock: () => number = Date.now,
  ) {}

  create(chatId: string, command: string, args: string[], rest: string): PendingAction {
    this.sweep()
    const old = this.byChat.get(chatId)
    if (old) {
      this.pending.delete(old)
      this.done.set(old, { at: this.clock(), outcome: 'cancelled' })
    }
    const now = this.clock()
    const p: PendingAction = { id: randomBytes(4).toString('hex'), chatId, command, args, rest, createdAt: now, expiresAt: now + this.ttlMs }
    this.pending.set(p.id, p)
    this.byChat.set(chatId, p.id)
    return p
  }

  attachMessage(id: string, messageId: number): void {
    const p = this.pending.get(id)
    if (p) p.messageId = messageId
  }

  pendingFor(chatId: string): PendingAction | undefined {
    const id = this.byChat.get(chatId)
    const p = id ? this.pending.get(id) : undefined
    return p && p.expiresAt > this.clock() ? p : undefined
  }

  resolve(id: string, chatId: string, decision: 'confirm' | 'cancel'): ResolveResult {
    this.sweep()
    const p = this.pending.get(id)
    if (!p) {
      const d = this.done.get(id)
      return { status: d ? (d.outcome === 'expired' ? 'expired' : 'already') : 'unknown' }
    }
    // A button from another chat never counts.
    if (p.chatId !== chatId) return { status: 'unknown' }
    this.pending.delete(id)
    if (this.byChat.get(chatId) === id) this.byChat.delete(chatId)
    if (p.expiresAt <= this.clock()) {
      this.done.set(id, { at: this.clock(), outcome: 'expired' })
      return { status: 'expired', pending: p }
    }
    this.done.set(id, { at: this.clock(), outcome: decision === 'confirm' ? 'confirmed' : 'cancelled' })
    return { status: decision === 'confirm' ? 'confirmed' : 'cancelled', pending: p }
  }

  /** Moves expired pending actions to the done list and forgets old decisions. */
  sweep(): void {
    const now = this.clock()
    for (const [id, p] of this.pending) {
      if (p.expiresAt <= now) {
        this.pending.delete(id)
        if (this.byChat.get(p.chatId) === id) this.byChat.delete(p.chatId)
        this.done.set(id, { at: now, outcome: 'expired' })
      }
    }
    for (const [id, d] of this.done) if (now - d.at > DONE_KEEP_MS) this.done.delete(id)
  }
}

/** Callback data is limited to 64 bytes: "c:<id>:y" or "c:<id>:n". */
export function callbackData(id: string, decision: 'confirm' | 'cancel'): string {
  return `c:${id}:${decision === 'confirm' ? 'y' : 'n'}`
}

export function parseCallbackData(data: string | undefined | null): { id: string; decision: 'confirm' | 'cancel' } | null {
  const m = /^c:([0-9a-f]{8}):([yn])$/.exec(data ?? '')
  return m ? { id: m[1], decision: m[2] === 'y' ? 'confirm' : 'cancel' } : null
}

export function confirmKeyboard(id: string): InlineKeyboard {
  return [
    [
      { text: 'Confirm', callback_data: callbackData(id, 'confirm') },
      { text: 'Cancel', callback_data: callbackData(id, 'cancel') },
    ],
  ]
}
