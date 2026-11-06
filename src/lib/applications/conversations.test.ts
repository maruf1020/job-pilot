import { describe, expect, it } from 'vitest'
import { conversationInputSchema } from './conversations'

describe('hiring conversation format', () => {
  it('keeps the questions, answers, system lines and form fields', () => {
    const c = conversationInputSchema.parse({
      title: 'Async hiring chat',
      channel: 'Company hiring chat',
      messages: [
        { role: 'them', text: "What's your full name?" },
        { role: 'me', text: 'Alex Rivera' },
        { role: 'note', text: 'Application sent' },
      ],
      fields: [{ label: 'Visa', value: 'Needs a visa' }],
    })
    expect(c.status).toBe('closed')
    expect(c.messages.map((m) => m.role)).toEqual(['them', 'me', 'note'])
    expect(c.fields).toEqual([{ label: 'Visa', value: 'Needs a visa' }])
  })

  it('rejects a conversation without messages or with an unknown speaker', () => {
    expect(conversationInputSchema.safeParse({ title: 'x', messages: [] }).success).toBe(false)
    expect(conversationInputSchema.safeParse({ title: 'x', messages: [{ role: 'bot', text: 'hi' }] }).success).toBe(false)
  })
})
