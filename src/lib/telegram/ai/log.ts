import fs from 'node:fs'
import path from 'node:path'

/**
 * storage/logs/telegram-ai.log: one line per /ai query. It records the question, the SQL, the row count and
 * the duration; never a result value.
 */

export interface AiLogEntry {
  question: string
  /** SQL statements run for this question (may be empty for a metric or a plain answer). */
  sql: string[]
  rows: number
  durationMs: number
  /** "metric", "sql", "plain", "command" or "fallback". */
  via: string
  /** A short error category, never row data. */
  error?: string
}

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)

export const aiLogPath = () => path.resolve(process.cwd(), 'storage', 'logs', 'telegram-ai.log')

export function formatAiLogLine(e: AiLogEntry, at = new Date()): string {
  return [at.toISOString(), `via=${e.via}`, `q=${JSON.stringify(oneLine(e.question, 300))}`, `sql=${JSON.stringify(e.sql.map((s) => oneLine(s, 1200)))}`, `rows=${e.rows}`, `ms=${e.durationMs}`, ...(e.error ? [`error=${JSON.stringify(oneLine(e.error, 120))}`] : [])].join(' | ')
}

export function logAiQuery(e: AiLogEntry, file = aiLogPath()): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${formatAiLogLine(e)}\n`)
  } catch {
    // Logging must never break an answer.
  }
}
