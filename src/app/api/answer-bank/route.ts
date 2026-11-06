import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { ensureAnswerBankSeeded, STANDARD_ENTRIES } from '@/lib/apply/answer-bank'
import { normalizeQuestion } from '@/lib/apply/match'
import { db } from '@/lib/db'

const ORDER = new Map(STANDARD_ENTRIES.map((e, i) => [e.key as string, i]))
const IMPORTANT = new Set(STANDARD_ENTRIES.filter((e) => e.important).map((e) => e.key as string))

/**
 * GET /api/answer-bank → { standard, questions, waiting }
 * standard = your details (name parts, links, salary...), questions = form questions met so far,
 * waiting = what the agent needs from you (no answer yet).
 */
export const GET = route(async () => {
  await ensureAnswerBankSeeded()
  const rows = await db.answerBank.findMany({ orderBy: [{ timesSeen: 'desc' }, { lastSeenAt: 'desc' }] })
  const standard = rows.filter((r) => r.key.startsWith('std:')).sort((a, b) => (ORDER.get(a.key) ?? 99) - (ORDER.get(b.key) ?? 99))
  const questions = rows.filter((r) => !r.key.startsWith('std:'))
  const waiting = rows.filter((r) => r.answer === null && (r.key.startsWith('std:') ? IMPORTANT.has(r.key) || r.timesSeen > 0 : true))
  return ok({ standard, questions, waiting })
})

const createSchema = z.object({
  question: z.string().min(2).max(500),
  answer: z.string().max(5000).nullable(),
  kind: z.enum(['text', 'textarea', 'choice', 'yesno', 'number', 'date']).default('text'),
  /** The question is one of your standard details (std:notice_period...): save it there, so every wording uses it. */
  stdKey: z.string().regex(/^std:[a-z_]+$/).optional(),
})

/** POST /api/answer-bank → add (or update) an answer to a question by its wording. */
export const POST = route(async (req) => {
  const input = await readJson(req, createSchema)
  if (input.stdKey) {
    const std = await db.answerBank.findUnique({ where: { key: input.stdKey } })
    if (std) {
      const row = await db.answerBank.update({ where: { key: input.stdKey }, data: { answer: input.answer, source: 'user' } })
      return ok(row, { message: 'Saved' })
    }
  }
  const key = normalizeQuestion(input.question).slice(0, 300)
  const row = await db.answerBank.upsert({
    where: { key },
    update: { answer: input.answer, source: 'user', kind: input.kind },
    create: { key, question: input.question, answer: input.answer, kind: input.kind, source: 'user', timesSeen: 0 },
  })
  return ok(row, { message: 'Saved' })
})
