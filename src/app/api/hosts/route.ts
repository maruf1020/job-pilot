import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client'
import { listResponse } from '@/lib/api/list'
import { badRequest, ok, readJson, route } from '@/lib/api/response'
import { HOST_KINDS, normalizeHost } from '@/lib/apply/hosts'
import { db } from '@/lib/db'
import type { TableQueryConfig } from '@/lib/table-query'

const HOSTS_TABLE: TableQueryConfig = {
  sortable: ['host', 'kind', 'attempts', 'submitted', 'failStreak', 'skipUntil', 'updatedAt'],
  searchable: ['host', 'lastReason'],
  filterable: {
    kind: { type: 'enum', values: HOST_KINDS, description: 'What the agent found on the host' },
    loggedIn: { type: 'boolean', description: 'You signed in once in the apply browser' },
    skipped: { type: 'boolean', description: 'Batches skip the host right now' },
  },
  defaultSort: { field: 'attempts', dir: 'desc' },
  sortNullsLast: ['skipUntil'],
}

/** GET /api/hosts → what the agent learned per website (host triage table). */
export const GET = route(async (req) => {
  const url = new URL(req.url)
  const skipped = url.searchParams.get('filter[skipped]')
  const now = new Date()
  const base: Prisma.HostProfileWhereInput =
    skipped === 'true'
      ? { skipUntil: { gt: now } }
      : skipped === 'false'
        ? { OR: [{ skipUntil: null }, { skipUntil: { lte: now } }] }
        : {}
  // "skipped" is virtual; strip it before the generic parser sees it.
  url.searchParams.delete('filter[skipped]')
  const cleaned = new Request(url.toString(), { headers: req.headers })
  return listResponse(
    cleaned,
    HOSTS_TABLE,
    async (args) => {
      const where = args.where as Prisma.HostProfileWhereInput
      // The list helper adds an `id` tiebreak; this table is keyed by host.
      const orderBy = (args.orderBy as Array<Record<string, unknown>>).map((o) => ('id' in o ? { host: o.id } : o)) as Prisma.HostProfileOrderByWithRelationInput[]
      const [rows, total] = await Promise.all([
        db.hostProfile.findMany({
          where,
          orderBy,
          skip: args.skip,
          take: args.take,
        }),
        db.hostProfile.count({ where }),
      ])
      // The table component keys rows by id.
      return [rows.map((r) => ({ id: r.host, ...r })), total]
    },
    base,
  )
})

const actionSchema = z.object({
  host: z.string().trim().min(3).max(253),
  action: z.enum(['logged-in', 'logged-out', 'skip-week', 'clear-skip']),
  /** What the queue saw on the host, used when the host has no row yet. */
  kind: z.enum(HOST_KINDS).optional(),
})

const MESSAGES: Record<z.infer<typeof actionSchema>['action'], string> = {
  'logged-in': 'Noted: you are signed in there. Batches will try it again.',
  'logged-out': 'Marked as not signed in',
  'skip-week': 'Skipped for a week',
  'clear-skip': 'Batches may use it again',
}

/** POST /api/hosts { host, action } → you signed in there, or skip / un-skip the host. */
export const POST = route(async (req) => {
  const input = await readJson(req, actionSchema)
  const host = normalizeHost(input.host)
  // Shared ATS hosts are tracked per company ("jobs.lever.co/kpler", see triageKey in apply/adapters).
  if (!/^[a-z0-9.-]+\.[a-z]{2,}(\/[a-z0-9._~@%+-]+)?$/.test(host)) throw badRequest('Not a host name')
  const data: Prisma.HostProfileUpdateInput =
    input.action === 'logged-in'
      ? { loggedIn: true, skipUntil: null, failStreak: 0 }
      : input.action === 'logged-out'
        ? { loggedIn: false }
        : input.action === 'skip-week'
          ? { skipUntil: new Date(Date.now() + 7 * 86_400_000) }
          : { skipUntil: null, failStreak: 0 }
  const row = await db.hostProfile.upsert({
    where: { host },
    update: data,
    create: {
      host,
      kind: input.kind ?? 'unknown',
      loggedIn: input.action === 'logged-in',
      skipUntil: input.action === 'skip-week' ? new Date(Date.now() + 7 * 86_400_000) : null,
    },
  })
  return ok(row, { message: MESSAGES[input.action] })
})
