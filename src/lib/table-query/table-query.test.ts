import { describe, expect, it } from 'vitest'
import { buildPrismaListArgs, createPaginationMeta, parseTableQuery, TableQueryError, type TableQueryConfig } from './index'

const config: TableQueryConfig = {
  sortable: ['score', 'title', 'createdAt'],
  searchable: ['title', 'companyName'],
  filterable: {
    country: { type: 'string', path: 'countryCode' },
    status: { type: 'enum', values: ['NEW', 'RANKED'] },
    score: { type: 'number', path: 'score.finalScore' },
    remote: { type: 'boolean' },
  },
  defaultSort: { field: 'createdAt', dir: 'desc' },
  sortMapping: { score: 'score.finalScore' },
}

describe('parseTableQuery', () => {
  it('applies defaults', () => {
    const q = parseTableQuery(new URLSearchParams(''), config)
    expect(q).toEqual({ page: 1, pageSize: 20, sort: { field: 'createdAt', dir: 'desc' }, search: null, filters: [] })
  })
  it('parses sort, search, pagination and filters', () => {
    const q = parseTableQuery(new URLSearchParams('page=3&pageSize=50&sort=-score&q=react&filter[country]=IE&filter[status][in]=NEW,RANKED&filter[score][gte]=60'), config)
    expect(q.page).toBe(3)
    expect(q.pageSize).toBe(50)
    expect(q.sort).toEqual({ field: 'score', dir: 'desc' })
    expect(q.search).toBe('react')
    expect(q.filters).toEqual([
      { field: 'country', op: 'eq', value: 'IE' },
      { field: 'status', op: 'in', value: ['NEW', 'RANKED'] },
      { field: 'score', op: 'gte', value: '60' },
    ])
  })
  it('rejects unknown fields, bad operators and bad enum values', () => {
    expect(() => parseTableQuery(new URLSearchParams('filter[nope]=1'), config)).toThrow(TableQueryError)
    expect(() => parseTableQuery(new URLSearchParams('filter[remote][contains]=1'), config)).toThrow(TableQueryError)
    expect(() => parseTableQuery(new URLSearchParams('filter[status]=BOGUS'), config)).toThrow(TableQueryError)
    expect(() => parseTableQuery(new URLSearchParams('sort=hacker'), config)).toThrow(TableQueryError)
  })
  it('clamps page size', () => {
    expect(parseTableQuery(new URLSearchParams('pageSize=9999'), config).pageSize).toBe(100)
  })
})

describe('buildPrismaListArgs', () => {
  it('builds nested where/orderBy', () => {
    const q = parseTableQuery(new URLSearchParams('sort=-score&q=react&filter[country]=IE&filter[score][gte]=60&filter[remote]=true'), config)
    const args = buildPrismaListArgs(q, config, { status: { not: 'SKIPPED' } })
    expect(args.orderBy).toEqual([{ score: { finalScore: 'desc' } }, { id: 'asc' }])
    expect(args.skip).toBe(0)
    expect(args.take).toBe(20)
    const and = (args.where as { AND: unknown[] }).AND
    expect(and[0]).toEqual({ status: { not: 'SKIPPED' } })
    expect(and[1]).toEqual({
      OR: [
        { title: { contains: 'react', mode: 'insensitive' } },
        { companyName: { contains: 'react', mode: 'insensitive' } },
      ],
    })
    expect(and[2]).toEqual({ countryCode: { equals: 'IE', mode: 'insensitive' } })
    expect(and[3]).toEqual({ score: { finalScore: { gte: 60 } } })
    expect(and[4]).toEqual({ remote: true })
  })
  it('creates pagination meta with filter descriptors', () => {
    const q = parseTableQuery(new URLSearchParams('pageSize=10'), config)
    const meta = createPaginationMeta(q, 95, config)
    expect(meta.totalPages).toBe(10)
    expect(meta.filterable.find((f) => f.field === 'status')?.values).toEqual(['NEW', 'RANKED'])
  })
})
