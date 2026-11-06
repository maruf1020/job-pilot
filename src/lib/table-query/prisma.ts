import type { PaginationMeta, ParsedFilter, ParsedTableQuery, TableQueryConfig } from './types'

// Prisma `where` objects are deeply dynamic; we build plain objects and let the
// caller cast to the model's WhereInput.
type AnyRecord = Record<string, unknown>

/** Sets a value at a dot path: ("company.name", {contains:"x"}) → {company:{name:{contains:"x"}}} */
function setPath(target: AnyRecord, path: string, value: unknown): AnyRecord {
  const parts = path.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    const next = (cursor[p] ??= {}) as AnyRecord
    cursor = next
  }
  cursor[parts[parts.length - 1]] = value
  return target
}

function coerce(type: string, raw: string): unknown {
  switch (type) {
    case 'number': {
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new Error(`Expected a number, got "${raw}"`)
      return n
    }
    case 'boolean':
      return raw === 'true' || raw === '1'
    case 'date': {
      const d = new Date(raw)
      if (Number.isNaN(d.getTime())) throw new Error(`Expected a date, got "${raw}"`)
      return d
    }
    default:
      return raw
  }
}

function filterToPrisma(f: ParsedFilter, config: TableQueryConfig): AnyRecord {
  const def = config.filterable[f.field]
  const path = def.path ?? f.field
  const t = def.type
  const single = (v: string | string[]) => coerce(t, Array.isArray(v) ? v[0] : v)
  const many = (v: string | string[]) => (Array.isArray(v) ? v : [v]).map((x) => coerce(t, x))

  let clause: unknown
  switch (f.op) {
    case 'eq':
      clause = t === 'string' ? { equals: single(f.value), mode: 'insensitive' } : single(f.value)
      break
    case 'ne':
      clause = t === 'string' ? { not: single(f.value), mode: 'insensitive' } : { not: single(f.value) }
      break
    case 'in':
      clause = { in: many(f.value) }
      break
    case 'nin':
      clause = { notIn: many(f.value) }
      break
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      clause = { [f.op]: single(f.value) }
      break
    case 'contains':
      clause = { contains: single(f.value), mode: 'insensitive' }
      break
    case 'isnull':
      clause = f.value === 'false' ? { not: null } : null
      break
  }
  return setPath({}, path, clause)
}

export interface PrismaListArgs {
  where: AnyRecord
  orderBy: AnyRecord[]
  skip: number
  take: number
}

/**
 * Turns a parsed query into Prisma list args. `baseWhere` is AND-ed in front
 * (e.g. `{ isArchived: false }`). Use `orderTieBreaker` for stable paging.
 */
export function buildPrismaListArgs(
  query: ParsedTableQuery,
  config: TableQueryConfig,
  baseWhere: AnyRecord = {},
  orderTieBreaker: AnyRecord = { id: 'asc' },
): PrismaListArgs {
  const and: AnyRecord[] = []
  if (Object.keys(baseWhere).length) and.push(baseWhere)

  if (query.search && config.searchable.length) {
    and.push({
      OR: config.searchable.map((field) =>
        setPath({}, config.searchMapping?.[field] ?? field, { contains: query.search, mode: 'insensitive' }),
      ),
    })
  }

  for (const f of query.filters) and.push(filterToPrisma(f, config))

  const sortPath = config.sortMapping?.[query.sort.field] ?? query.sort.field
  // Prisma only accepts { sort, nulls } on scalar (non-relation) order fields.
  const sortValue = config.sortNullsLast?.includes(query.sort.field) && !sortPath.includes('.') ? { sort: query.sort.dir, nulls: 'last' } : query.sort.dir
  const orderBy = [setPath({}, sortPath, sortValue), orderTieBreaker]

  return {
    where: and.length === 0 ? {} : and.length === 1 ? and[0] : { AND: and },
    orderBy,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  }
}

export function createPaginationMeta(
  query: ParsedTableQuery,
  total: number,
  config: TableQueryConfig,
): PaginationMeta {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    sortable: config.sortable,
    searchable: config.searchable,
    filterable: Object.entries(config.filterable).map(([field, d]) => ({
      field,
      type: d.type,
      description: d.description,
      values: d.values,
    })),
  }
}
