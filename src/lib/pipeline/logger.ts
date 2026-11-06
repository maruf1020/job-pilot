import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface RunLogger {
  log: (level: LogLevel, message: string, meta?: Record<string, unknown>) => void
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
  debug: (message: string, meta?: Record<string, unknown>) => void
  flush: () => Promise<void>
}

/**
 * Buffered logger that writes `SearchRunLog` rows (debug lines stay in the console only).
 */
export function createRunLogger(runId: string | null, prefix = 'run'): RunLogger {
  let buffer: Array<{ runId: string; level: string; message: string; meta?: Prisma.InputJsonValue }> = []
  let flushing: Promise<void> | null = null

  const flush = async () => {
    if (!runId || buffer.length === 0) return
    const batch = buffer
    buffer = []
    flushing = db.searchRunLog
      .createMany({ data: batch })
      .then(() => undefined)
      .catch((err) => console.error('[logger] failed to persist logs', err))
    await flushing
  }

  const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    const line = `[${prefix}${runId ? `:${runId.slice(-6)}` : ''}] ${message}`
    if (level === 'error') console.error(line, meta ?? '')
    else if (level === 'warn') console.warn(line, meta ?? '')
    else console.log(line, meta ? JSON.stringify(meta) : '')
    if (runId && level !== 'debug') {
      buffer.push({ runId, level, message: message.slice(0, 2000), meta: meta ? (safeJson(meta) as Prisma.InputJsonValue) : undefined })
      if (buffer.length >= 20) void flush()
    }
  }

  return {
    log,
    info: (m, meta) => log('info', m, meta),
    warn: (m, meta) => log('warn', m, meta),
    error: (m, meta) => log('error', m, meta),
    debug: (m, meta) => log('debug', m, meta),
    flush,
  }
}

function safeJson(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v, (_k, val) => (val instanceof Error ? { message: val.message } : val)))
  } catch {
    return { note: 'unserializable meta' }
  }
}
