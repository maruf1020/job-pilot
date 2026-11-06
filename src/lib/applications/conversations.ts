import { z } from 'zod'
import { db } from '@/lib/db'

/**
 * Hiring conversations kept with an application: a chat-style interview or screening (some companies
 * hire through a chat bot), stored as the full back-and-forth so the person can reread exactly what was
 * asked and what they answered. Kept as application events (type "conversation",
 * everything in meta) like hiring stages and preps, so no schema change is needed.
 */
export const CONVERSATION_ROLES = ['them', 'me', 'note'] as const
export type ConversationRole = (typeof CONVERSATION_ROLES)[number]

export const conversationMessageSchema = z.object({
  /** them = the company or its hiring bot, me = the candidate's answer, note = a system line ("Application sent"). */
  role: z.enum(CONVERSATION_ROLES),
  text: z.string().min(1).max(20_000),
})
export type ConversationMessage = z.infer<typeof conversationMessageSchema>

export const conversationFieldSchema = z.object({ label: z.string().min(1).max(200), value: z.string().max(2000) })
export type ConversationField = z.infer<typeof conversationFieldSchema>

export const conversationInputSchema = z.object({
  title: z.string().min(1).max(200),
  /** Where it happened: "Hiring chat on hiring.theagilemonkeys.com", "Video call", ... */
  channel: z.string().max(200).nullish(),
  url: z.url().max(1000).nullish(),
  /** When it took place (ISO date or date-time). */
  happenedAt: z.string().max(40).nullish(),
  /** Closed, or still open for more answers. */
  status: z.enum(['open', 'closed']).default('closed'),
  /** One-line takeaway shown on top. */
  summary: z.string().max(1000).nullish(),
  messages: z.array(conversationMessageSchema).min(1).max(400),
  /** Form fields filled during the conversation (name, visa, salary...). */
  fields: z.array(conversationFieldSchema).max(50).default([]),
})
export type ConversationInput = z.infer<typeof conversationInputSchema>

export interface HiringConversation extends ConversationInput {
  id: string
  createdAt: string
}

export async function loadConversations(applicationId: string): Promise<HiringConversation[]> {
  const rows = await db.applicationEvent.findMany({ where: { applicationId, type: 'conversation' }, orderBy: { createdAt: 'desc' } })
  const out: HiringConversation[] = []
  for (const r of rows) {
    const parsed = conversationInputSchema.safeParse(r.meta)
    if (parsed.success) out.push({ ...parsed.data, id: r.id, createdAt: r.createdAt.toISOString() })
  }
  return out
}

export async function saveConversation(applicationId: string, input: ConversationInput) {
  const data = conversationInputSchema.parse(input)
  return db.applicationEvent.create({
    data: { applicationId, type: 'conversation', message: `Conversation saved: ${data.title}`, meta: data as object },
  })
}

export async function deleteConversation(applicationId: string, id: string) {
  const r = await db.applicationEvent.deleteMany({ where: { id, applicationId, type: 'conversation' } })
  return r.count > 0
}

/** What the AI returns when splitting a pasted transcript. */
export const splitTranscriptSchema = z.object({
  messages: z.array(conversationMessageSchema).min(1),
  fields: z.array(conversationFieldSchema).default([]),
  summary: z.string().max(1000).nullish(),
})

/**
 * Splits a pasted chat transcript into turns (who said what) with Gemini. The text is kept word for word;
 * only the speaker and the boundaries are decided.
 */
export async function splitTranscript(raw: string, company: string): Promise<z.infer<typeof splitTranscriptSchema>> {
  const { generateJson } = await import('@/lib/ai/gemini')
  const { loadCandidateContext } = await import('@/lib/candidate/load')
  const candidate = await loadCandidateContext()
  // The name helps the model tell the candidate's lines from the company's; a fresh install has none yet.
  const who = candidate.fullName ? ` The candidate is ${candidate.fullName}.` : ''
  const { data } = await generateJson({
    task: 'transcript',
    model: 'lite',
    temperature: 0.1,
    maxOutputTokens: 16_000,
    schema: splitTranscriptSchema,
    system: `You split a pasted hiring-chat transcript into messages.${who} Keep every word exactly as written; never summarize, translate or fix text. Decide only who wrote each part and where one message ends.`,
    prompt: [
      `Company: ${company}`,
      'Rules:',
      '- role "them": the company or its hiring bot (questions, acknowledgements, instructions).',
      '- role "me": the candidate\'s answers.',
      '- role "note": UI/system lines such as "Application sent", "Conversation closed", buttons or choices shown on screen.',
      '- A short form inside the chat (Full name / Email / Visa / Salary ...) goes to "fields" as label/value pairs instead of messages.',
      '- "summary": one sentence on what the conversation was and how it ended.',
      '',
      'Transcript:',
      raw.slice(0, 60_000),
    ].join('\n'),
  })
  return data
}
