import { TelegramApiError, type TelegramClient } from './client'
import type { OffsetStore } from './offset'
import type { BotCommandMenuItem, TgUpdate } from './types'

/**
 * Long-polling loop: one getUpdates consumer. Telegram allows a single consumer per bot (a second one gets a
 * 409), so the worker starts this in exactly one role (roles.ts runsTelegramPoller). The offset is saved after
 * every batch of updates, and failures back off instead of spinning.
 */

export const POLL_TIMEOUT_SEC = 25
const BACKOFF_MAX_MS = 60_000
const CONFLICT_WAIT_MS = 30_000

export function backoffMs(failures: number): number {
  return Math.min(BACKOFF_MAX_MS, 1000 * 2 ** Math.max(0, failures - 1))
}

export interface PollerDeps {
  client: TelegramClient
  handleUpdate: (update: TgUpdate) => Promise<void>
  offsets: OffsetStore
  menu: BotCommandMenuItem[]
  log?: (message: string) => void
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  timeoutSec?: number
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

export async function runPoller(deps: PollerDeps, signal: AbortSignal): Promise<void> {
  const log = deps.log ?? (() => undefined)
  const sleep = deps.sleep ?? defaultSleep
  let offset = deps.offsets.load()

  // The command menu and "no webhook" (a webhook would block getUpdates) are set once, before polling.
  await deps.client.deleteWebhook().catch((err) => log(`deleteWebhook failed: ${err instanceof Error ? err.message : err}`))
  await deps.client.setMyCommands(deps.menu).catch((err) => log(`setMyCommands failed: ${err instanceof Error ? err.message : err}`))
  log(`polling started (${deps.menu.length} commands in the menu)`)

  let failures = 0
  while (!signal.aborted) {
    let updates: TgUpdate[]
    try {
      updates = await deps.client.getUpdates(offset, deps.timeoutSec ?? POLL_TIMEOUT_SEC, signal)
      failures = 0
    } catch (err) {
      if (signal.aborted) break
      failures++
      const conflict = err instanceof TelegramApiError && err.status === 409
      const wait = conflict ? CONFLICT_WAIT_MS : backoffMs(failures)
      log(conflict ? 'another process is reading this bot (409); waiting' : `getUpdates failed (${err instanceof Error ? err.message : err}); retry in ${Math.round(wait / 1000)}s`)
      await sleep(wait, signal)
      continue
    }
    for (const update of updates) {
      // Advance before handling: a command that crashes must not be replayed forever.
      offset = Math.max(offset, update.update_id + 1)
      deps.offsets.save(offset)
      try {
        await deps.handleUpdate(update)
      } catch (err) {
        log(`update ${update.update_id} failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  log('polling stopped')
}
