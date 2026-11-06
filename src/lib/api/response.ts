import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { UnauthorizedError, requireUser } from '@/lib/auth'
import { TableQueryError } from '@/lib/table-query'
import type { PaginationMeta } from '@/lib/table-query'

/**
 * Success envelope (one shape for every route, so the client handles them the same way):
 * { success, statusCode, message, data, meta?, timestamp }
 */
export function ok<T>(data: T, init?: { status?: number; message?: string; meta?: PaginationMeta | Record<string, unknown> }) {
  const status = init?.status ?? 200
  return NextResponse.json(
    {
      success: true,
      statusCode: status,
      message: init?.message ?? 'OK',
      data,
      ...(init?.meta ? { meta: init.meta } : {}),
      timestamp: new Date().toISOString(),
    },
    { status },
  )
}

export function fail(status: number, message: string, errors?: unknown) {
  return NextResponse.json(
    {
      success: false,
      statusCode: status,
      message,
      ...(errors !== undefined ? { errors } : {}),
      timestamp: new Date().toISOString(),
    },
    { status },
  )
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`)
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details)

type PrismaLikeError = { code?: string; meta?: unknown; message?: string }

export function errorToResponse(error: unknown) {
  if (error instanceof HttpError) return fail(error.status, error.message, error.details)
  if (error instanceof UnauthorizedError) return fail(401, error.message)
  if (error instanceof TableQueryError) return fail(400, error.message)
  if (error instanceof ZodError) {
    return fail(
      422,
      'Validation failed',
      error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  const e = error as PrismaLikeError
  if (typeof e?.code === 'string' && e.code.startsWith('P')) {
    switch (e.code) {
      case 'P2002':
        return fail(409, 'Already exists', e.meta)
      case 'P2003':
        return fail(400, 'Invalid reference', e.meta)
      case 'P2025':
        return fail(404, 'Not found')
    }
  }
  console.error('[api] unhandled error', error)
  return fail(500, error instanceof Error ? error.message : 'Internal error')
}

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response>

/** Wraps a route handler: enforces auth (unless `public`) and maps errors to the envelope. */
export function route<Ctx = { params: Promise<Record<string, string>> }>(
  handler: Handler<Ctx>,
  opts: { public?: boolean } = {},
): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      if (!opts.public) await requireUser()
      return await handler(req, ctx)
    } catch (error) {
      return errorToResponse(error)
    }
  }
}

export async function readJson<T>(req: Request, schema: { parse: (v: unknown) => T }): Promise<T> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw badRequest('Body must be valid JSON')
  }
  return schema.parse(body)
}
