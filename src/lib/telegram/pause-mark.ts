/**
 * Prefix of the `waitingFor` text the Telegram /pause command writes on a running batch. The batch ticks
 * read it (apply-batch.ts) and stay idle while it is there; /resume clears it. No worker restart involved.
 */
export const PAUSE_MARK = 'Paused from Telegram'

export const isPausedFromTelegram = (waitingFor: string | null | undefined): boolean => Boolean(waitingFor?.startsWith(PAUSE_MARK))
