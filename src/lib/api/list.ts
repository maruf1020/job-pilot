import { buildPrismaListArgs, createPaginationMeta, parseTableQuery, type PrismaListArgs, type TableQueryConfig } from '@/lib/table-query'
import { ok } from './response'

type AnyRecord = Record<string, unknown>

/**
 * Standard list endpoint: parse the query DSL, hand Prisma args to `load`, return the envelope.
 * `load` returns [rows, total].
 */
export async function listResponse<T>(
  req: Request,
  config: TableQueryConfig,
  load: (args: PrismaListArgs, search: string | null) => Promise<[T[], number]>,
  baseWhere: AnyRecord = {},
) {
  const query = parseTableQuery(new URL(req.url).searchParams, config)
  const args = buildPrismaListArgs(query, config, baseWhere)
  const [data, total] = await load(args, query.search)
  return ok(data, { meta: createPaginationMeta(query, total, config) })
}
