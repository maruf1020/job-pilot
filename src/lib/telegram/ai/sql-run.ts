import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { RESULT_ROW_LIMIT, validateSelect, wrapLimited } from './sql-guard'

/**
 * Runs a validated SELECT inside a READ ONLY transaction with a statement timeout, and always rolls back.
 * The executor is injectable so tests can prove the order of the statements and the rollback.
 */

export const STATEMENT_TIMEOUT = '5s'
export const CELL_MAX = 300
/** Characters of result rows handed to the model. */
export const PROMPT_RESULT_MAX = 12_000

export type Row = Record<string, unknown>

/** Runs the wrapped query and returns the raw rows. Implementations must be read-only and roll back. */
export type QueryExecutor = (wrappedSql: string) => Promise<Row[]>

export interface SqlResult {
  columns: string[]
  rows: Row[]
  rowCount: number
  /** The 50-row limit cut the result. */
  limited: boolean
  durationMs: number
}

class Rollback extends Error {
  constructor(readonly rows: Row[]) {
    super('rollback')
  }
}

/** The transaction body, shared by the real executor and the tests. */
export async function readOnlyTransaction(tx: { $executeRawUnsafe: (q: string) => Promise<unknown>; $queryRawUnsafe: (q: string) => Promise<unknown> }, wrappedSql: string): Promise<never> {
  // Must be the first statement of the transaction: from here on any write is rejected by Postgres.
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`)
  const rows = (await tx.$queryRawUnsafe(wrappedSql)) as Row[]
  // Roll back always: nothing a query did (it cannot do anything) is ever committed.
  throw new Rollback(rows)
}

export function prismaExecutor(client: Pick<PrismaClient, '$transaction'>): QueryExecutor {
  return async (wrappedSql) => {
    try {
      await client.$transaction((tx) => readOnlyTransaction(tx, wrappedSql), { timeout: 10_000, maxWait: 5_000 })
    } catch (err) {
      if (err instanceof Rollback) return err.rows
      throw err
    }
    return []
  }
}

let readerClient: PrismaClient | null = null

/** The dedicated read-only connection when AI_QUERY_DATABASE_URL is set, else the app's own client. */
export function queryClient(): PrismaClient {
  if (!env.AI_QUERY_DATABASE_URL) return db
  if (!readerClient) readerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.AI_QUERY_DATABASE_URL, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 }), log: ['error'] })
  return readerClient
}

export const defaultExecutor: QueryExecutor = (sql) => prismaExecutor(queryClient())(sql)

/** One cell as something short and JSON-safe. */
export function normalizeCell(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string') return value.length > CELL_MAX ? `${value.slice(0, CELL_MAX)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Uint8Array) return '[binary]'
  const json = JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  return json && json.length > CELL_MAX ? `${json.slice(0, CELL_MAX)}...` : json
}

export function normalizeRows(rows: Row[], maxRows = RESULT_ROW_LIMIT): Row[] {
  return rows.slice(0, maxRows).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, normalizeCell(v)])))
}

export class SqlRejectedError extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'SqlRejectedError'
  }
}

export async function runReadOnlySql(sql: string, executor: QueryExecutor = defaultExecutor, now: () => number = Date.now): Promise<SqlResult> {
  const checked = validateSelect(sql)
  if (!checked.ok) throw new SqlRejectedError(checked.reason)
  const started = now()
  const raw = await executor(wrapLimited(checked.sql))
  const rows = normalizeRows(raw)
  return { columns: rows[0] ? Object.keys(rows[0]) : [], rows, rowCount: rows.length, limited: raw.length >= RESULT_ROW_LIMIT, durationMs: now() - started }
}

/** The rows as JSON for the model, cut to PROMPT_RESULT_MAX characters (whole rows only). */
export function resultForPrompt(result: SqlResult, maxChars = PROMPT_RESULT_MAX): string {
  const kept: Row[] = []
  let size = 2
  for (const row of result.rows) {
    const s = JSON.stringify(row).length + 1
    if (size + s > maxChars) break
    kept.push(row)
    size += s
  }
  const note = kept.length < result.rows.length ? ` (only the first ${kept.length} of ${result.rowCount} rows shown)` : result.limited ? ` (result limited to ${RESULT_ROW_LIMIT} rows)` : ''
  return `${JSON.stringify(kept)}${note}`
}
