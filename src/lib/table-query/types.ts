export type FilterType = 'string' | 'number' | 'boolean' | 'date' | 'enum'

export type FilterOp = 'eq' | 'ne' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'isnull'

export interface FilterDef {
  type: FilterType
  description?: string
  /** For `enum` type: the accepted values. */
  values?: readonly string[]
  /** Override the Prisma path (dot-separated) when the logical name differs. */
  path?: string
}

export interface TableQueryConfig {
  sortable: readonly string[]
  searchable: readonly string[]
  filterable: Record<string, FilterDef>
  defaultSort: { field: string; dir: 'asc' | 'desc' }
  /** Logical sort field → Prisma path (dot-separated) when they differ. */
  sortMapping?: Record<string, string>
  /** Logical searchable field → Prisma path when they differ. */
  searchMapping?: Record<string, string>
  /** Sort fields that live on an optional relation and must put NULLs last. */
  sortNullsLast?: readonly string[]
  maxPageSize?: number
  defaultPageSize?: number
}

export interface ParsedFilter {
  field: string
  op: FilterOp
  value: string | string[]
}

export interface ParsedTableQuery {
  page: number
  pageSize: number
  sort: { field: string; dir: 'asc' | 'desc' }
  search: string | null
  filters: ParsedFilter[]
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
  sortable: readonly string[]
  searchable: readonly string[]
  filterable: Array<{ field: string; type: FilterType; description?: string; values?: readonly string[] }>
}

export interface PagedResult<T> {
  data: T[]
  meta: PaginationMeta
}

export class TableQueryError extends Error {
  status = 400
  constructor(message: string) {
    super(message)
    this.name = 'TableQueryError'
  }
}

const OPS_BY_TYPE: Record<FilterType, FilterOp[]> = {
  string: ['eq', 'ne', 'in', 'nin', 'contains', 'isnull'],
  number: ['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'isnull'],
  boolean: ['eq', 'isnull'],
  date: ['eq', 'gt', 'gte', 'lt', 'lte', 'isnull'],
  enum: ['eq', 'ne', 'in', 'nin', 'isnull'],
}

export function isOpAllowed(type: FilterType, op: FilterOp): boolean {
  return OPS_BY_TYPE[type].includes(op)
}
