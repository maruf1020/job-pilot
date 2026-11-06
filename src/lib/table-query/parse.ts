import {
  type FilterOp,
  type ParsedFilter,
  type ParsedTableQuery,
  type TableQueryConfig,
  TableQueryError,
  isOpAllowed,
} from './types'

const FILTER_RE = /^filter\[([a-zA-Z0-9_.]+)\](?:\[([a-z]+)\])?$/
const VALID_OPS: FilterOp[] = ['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'contains', 'isnull']

/**
 * Wire format:
 *   ?page=1&pageSize=20&sort=-score&q=react&filter[country]=IE&filter[score][gte]=60&filter[status][in]=NEW,RANKED
 */
export function parseTableQuery(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
  config: TableQueryConfig,
): ParsedTableQuery {
  const params = input instanceof URLSearchParams ? input : toSearchParams(input)
  const maxPageSize = config.maxPageSize ?? 100
  const defaultPageSize = config.defaultPageSize ?? 20

  const page = clampInt(params.get('page'), 1, 1, 100000)
  const pageSize = clampInt(params.get('pageSize'), defaultPageSize, 1, maxPageSize)

  const sort = parseSort(params.get('sort'), config)
  const search = (params.get('q') ?? '').trim() || null

  const filters: ParsedFilter[] = []
  for (const [key, rawValue] of params.entries()) {
    const m = FILTER_RE.exec(key)
    if (!m) continue
    const field = m[1]
    const op = (m[2] ?? 'eq') as FilterOp
    const def = config.filterable[field]
    if (!def) throw new TableQueryError(`Unknown filter field "${field}"`)
    if (!VALID_OPS.includes(op)) throw new TableQueryError(`Unknown filter operator "${op}"`)
    if (!isOpAllowed(def.type, op)) {
      throw new TableQueryError(`Operator "${op}" is not allowed for ${def.type} field "${field}"`)
    }
    const value = rawValue.trim()
    if (value === '' && op !== 'isnull') continue
    if (def.type === 'enum' && def.values && op !== 'isnull') {
      const vals = op === 'in' || op === 'nin' ? value.split(',') : [value]
      for (const v of vals) {
        if (!def.values.includes(v)) throw new TableQueryError(`Invalid value "${v}" for "${field}"`)
      }
    }
    filters.push({
      field,
      op,
      value: op === 'in' || op === 'nin' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value,
    })
  }

  return { page, pageSize, sort, search, filters }
}

function parseSort(raw: string | null, config: TableQueryConfig) {
  if (!raw) return config.defaultSort
  const dir: 'asc' | 'desc' = raw.startsWith('-') ? 'desc' : 'asc'
  const field = raw.replace(/^[-+]/, '')
  if (!config.sortable.includes(field)) throw new TableQueryError(`Cannot sort by "${field}"`)
  return { field, dir }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function toSearchParams(obj: Record<string, string | string[] | undefined>): URLSearchParams {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x))
    else sp.append(k, v)
  }
  return sp
}
