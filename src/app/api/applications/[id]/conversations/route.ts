import { z } from 'zod'
import { badRequest, notFound, ok, readJson, route } from '@/lib/api/response'
import {
  conversationFieldSchema,
  conversationInputSchema,
  conversationMessageSchema,
  deleteConversation,
  loadConversations,
  saveConversation,
  splitTranscript,
} from '@/lib/applications/conversations'
import { db } from '@/lib/db'

/** GET /api/applications/:id/conversations */
export const GET = route(async (_req, { params }) => {
  const { id } = await params
  return ok(await loadConversations(id))
})

const postSchema = z.object({
  title: z.string().min(1).max(200),
  channel: z.string().max(200).nullish(),
  url: z.url().max(1000).nullish(),
  happenedAt: z.string().max(40).nullish(),
  status: z.enum(['open', 'closed']).optional(),
  summary: z.string().max(1000).nullish(),
  /** Either ready-made messages, or the raw pasted transcript for the AI to split into turns. */
  messages: z.array(conversationMessageSchema).max(400).optional(),
  fields: z.array(conversationFieldSchema).max(50).optional(),
  raw: z.string().max(60_000).optional(),
})

/** POST /api/applications/:id/conversations: save a hiring conversation (structured, or split from a paste). */
export const POST = route(async (req, { params }) => {
  const { id } = await params
  const body = await readJson(req, postSchema)
  const app = await db.application.findUnique({ where: { id }, select: { id: true, job: { select: { companyName: true } } } })
  if (!app) throw notFound('Application')
  let messages = body.messages ?? []
  let fields = body.fields ?? []
  let summary = body.summary ?? null
  if (!messages.length) {
    if (!body.raw?.trim()) throw badRequest('Paste the conversation or send its messages')
    const split = await splitTranscript(body.raw, app.job.companyName)
    messages = split.messages
    fields = fields.length ? fields : split.fields
    summary = summary ?? split.summary ?? null
  }
  const input = conversationInputSchema.parse({ ...body, messages, fields, summary, status: body.status ?? 'closed' })
  const saved = await saveConversation(id, input)
  return ok({ id: saved.id }, { status: 201, message: 'Conversation saved' })
})

/** DELETE /api/applications/:id/conversations?conversationId=... */
export const DELETE = route(async (req, { params }) => {
  const { id } = await params
  const conversationId = new URL(req.url).searchParams.get('conversationId')
  if (!conversationId) throw badRequest('conversationId is required')
  if (!(await deleteConversation(id, conversationId))) throw notFound('Conversation')
  return ok({ deleted: true })
})
