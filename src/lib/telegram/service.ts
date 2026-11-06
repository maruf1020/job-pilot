import { getServiceCredential } from '@/lib/keys/service-keys'
import { createBot } from './bot'
import { clientFromEnv } from './client'
import { buildRegistry } from './commands'
import { fileOffsetStore } from './offset'
import { runPoller } from './poller'

/**
 * Starts the two-way bot inside a worker process. Safe to call more than once; does nothing when the token or
 * the chat id is missing. The worker calls it only in the role that owns the poller (roles.ts).
 */
let controller: AbortController | null = null

export async function startTelegramService(log: (message: string) => void = console.log): Promise<boolean> {
  if (controller) return true
  const client = await clientFromEnv()
  const chatId = (await getServiceCredential('telegram'))?.TELEGRAM_CHAT_ID?.trim()
  if (!client || !chatId) return false
  const registry = buildRegistry()
  const bot = createBot({ client, registry, allowedChatId: chatId, log })
  controller = new AbortController()
  const c = controller
  void runPoller({ client, handleUpdate: bot.handleUpdate, offsets: fileOffsetStore(), menu: registry.menu(), log }, c.signal).catch((err) => {
    log(`poller crashed: ${err instanceof Error ? err.message : err}`)
    if (controller === c) controller = null
  })
  return true
}

export function stopTelegramService(): void {
  controller?.abort()
  controller = null
}
