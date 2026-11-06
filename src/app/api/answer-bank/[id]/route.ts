import { z } from 'zod'
import { badRequest, notFound, ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'

const patchSchema = z.object({
  /** null = waiting for you, '' = leave blank on purpose. */
  answer: z.string().max(5000).nullable(),
})

/** PATCH /api/answer-bank/:id → your answer (used on every later form). */
export const PATCH = route(async (req, { params }) => {
  const { id } = await params
  const input = await readJson(req, patchSchema)
  const row = await db.answerBank.findUnique({ where: { id } })
  if (!row) throw notFound('Answer')
  const updated = await db.answerBank.update({ where: { id }, data: { answer: input.answer === null ? null : input.answer.trim(), source: 'user' } })
  return ok(updated, { message: 'Saved' })
})

/** DELETE /api/answer-bank/:id → forget a learned question (standard details cannot be deleted). */
export const DELETE = route(async (_req, { params }) => {
  const { id } = await params
  const row = await db.answerBank.findUnique({ where: { id } })
  if (!row) throw notFound('Answer')
  if (row.key.startsWith('std:')) throw badRequest('Standard details cannot be deleted; clear the answer instead')
  await db.answerBank.delete({ where: { id } })
  return ok({ deleted: true })
})
