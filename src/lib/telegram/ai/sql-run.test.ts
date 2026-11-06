import { describe, expect, it, vi } from 'vitest'
import { CELL_MAX, normalizeCell, normalizeRows, prismaExecutor, readOnlyTransaction, resultForPrompt, runReadOnlySql, SqlRejectedError, type SqlResult } from './sql-run'

/** A fake Prisma transaction client: Postgres-like, rejects any write while the transaction is READ ONLY. */
function fakeClient(rows: Array<Record<string, unknown>> = [{ n: 1 }]) {
  const log: string[] = []
  let readOnly = false
  let rolledBack = false
  const tx = {
    $executeRawUnsafe: vi.fn(async (q: string) => {
      log.push(q)
      if (/^SET TRANSACTION READ ONLY/i.test(q)) readOnly = true
      return 0
    }),
    $queryRawUnsafe: vi.fn(async (q: string) => {
      log.push(q)
      if (/^\s*(insert|update|delete|drop|create|alter)/i.test(q) && readOnly) throw new Error('cannot execute in a read-only transaction')
      return rows
    }),
  }
  const client = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      try {
        return await fn(tx)
      } catch (err) {
        rolledBack = true // a throw inside the callback rolls the transaction back
        throw err
      }
    }),
  }
  return { client: client as never, tx, log, rolledBack: () => rolledBack }
}

describe('read-only transaction', () => {
  it('sets READ ONLY first, then the timeout, then the query, and always rolls back', async () => {
    const f = fakeClient([{ n: 3 }])
    const rows = await prismaExecutor(f.client)('SELECT * FROM (SELECT 1) AS t LIMIT 50')
    expect(rows).toEqual([{ n: 3 }])
    expect(f.log[0]).toBe('SET TRANSACTION READ ONLY')
    expect(f.log[1]).toBe("SET LOCAL statement_timeout = '5s'")
    expect(f.log[2]).toBe('SELECT * FROM (SELECT 1) AS t LIMIT 50')
    expect(f.rolledBack()).toBe(true)
  })

  it('a write run inside it is rejected by the database (simulated) and surfaces as an error', async () => {
    const f = fakeClient()
    await expect(prismaExecutor(f.client)('UPDATE "Job" SET title = \'x\'')).rejects.toThrow(/read-only/)
    expect(f.log[0]).toBe('SET TRANSACTION READ ONLY')
  })

  it('never commits: even a successful query ends in a rollback throw', async () => {
    const f = fakeClient()
    await expect(readOnlyTransaction(f.tx, 'SELECT 1')).rejects.toThrow('rollback')
  })
})

describe('runReadOnlySql', () => {
  it('rejects anything the guard rejects before touching the database', async () => {
    const executor = vi.fn(async () => [])
    await expect(runReadOnlySql('DELETE FROM "Job"', executor)).rejects.toBeInstanceOf(SqlRejectedError)
    await expect(runReadOnlySql('SELECT 1; SELECT 2', executor)).rejects.toThrow(/semicolon/)
    await expect(runReadOnlySql('SELECT * FROM "User"', executor)).rejects.toThrow(/not allowed/)
    expect(executor).not.toHaveBeenCalled()
  })

  it('wraps the query in the outer LIMIT 50 select', async () => {
    const executor = vi.fn(async () => [{ a: 1 }])
    const r = await runReadOnlySql('SELECT count(*) AS a FROM "Job"', executor)
    expect(executor).toHaveBeenCalledWith('SELECT * FROM (SELECT count(*) AS a FROM "Job") AS t LIMIT 50')
    expect(r).toMatchObject({ rowCount: 1, columns: ['a'], limited: false })
  })

  it('caps rows at 50 and flags the cut', async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ i }))
    const r = await runReadOnlySql('SELECT id FROM "Job"', async () => many)
    expect(r.rows).toHaveLength(50)
    expect(r.limited).toBe(true)
  })
})

describe('result truncation', () => {
  it('cuts long text cells to 300 characters', () => {
    const cell = normalizeCell('x'.repeat(1000)) as string
    expect(cell.length).toBe(CELL_MAX + 3)
    expect(cell.endsWith('...')).toBe(true)
    expect(normalizeCell('short')).toBe('short')
  })

  it('makes bigint, dates, json and binary JSON-safe', () => {
    expect(normalizeCell(BigInt(5))).toBe(5)
    const huge = BigInt(2) ** BigInt(70)
    expect(normalizeCell(huge)).toBe(huge.toString())
    expect(normalizeCell(new Date('2026-11-05T00:00:00Z'))).toBe('2026-11-05T00:00:00.000Z')
    expect(normalizeCell(new Uint8Array([1]))).toBe('[binary]')
    expect(normalizeCell({ a: 'y'.repeat(500) }) as string).toHaveLength(CELL_MAX + 3)
    expect(normalizeCell(undefined)).toBeNull()
  })

  it('normalizes every cell of every row', () => {
    const rows = normalizeRows([{ body: 'z'.repeat(900), n: BigInt(1) }])
    expect((rows[0].body as string).length).toBe(CELL_MAX + 3)
    expect(rows[0].n).toBe(1)
  })

  it('caps what is sent to the model by size, whole rows only', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ i, text: 'q'.repeat(280) }))
    const result: SqlResult = { columns: ['i', 'text'], rows, rowCount: 50, limited: true, durationMs: 1 }
    const text = resultForPrompt(result, 3000)
    expect(text.length).toBeLessThan(3400)
    expect(text).toMatch(/only the first \d+ of 50 rows shown/)
    const json = text.slice(0, text.lastIndexOf(']') + 1)
    expect(() => JSON.parse(json)).not.toThrow()
  })
})
