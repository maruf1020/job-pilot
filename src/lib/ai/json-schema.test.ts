import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { jsonInstruction, stripNulls, toOpenAiStrictSchema, zodToJsonSchema } from './json-schema'

describe('toOpenAiStrictSchema', () => {
  it('closes every object, requires every property and makes optional ones nullable', () => {
    const schema = z.object({
      subject: z.string().min(3).max(120),
      body: z.string(),
      score: z.number().int().min(0).max(100).optional(),
      tags: z.array(z.object({ name: z.string(), weight: z.number().default(1) })).max(5),
      kind: z.enum(['email', 'form']),
      fixed: z.literal('v1'),
    })
    const { schema: s, strict } = toOpenAiStrictSchema(zodToJsonSchema(schema))
    expect(strict).toBe(true)
    expect(s.type).toBe('object')
    expect(s.additionalProperties).toBe(false)
    expect(s.required).toEqual(['subject', 'body', 'score', 'tags', 'kind', 'fixed'])
    const props = s.properties as Record<string, Record<string, unknown>>
    // Unsupported keywords are dropped (the zod parse still enforces them).
    expect(props.subject).toEqual({ type: 'string' })
    expect(props.score.type).toEqual(['integer', 'null'])
    expect(props.score).not.toHaveProperty('minimum')
    expect(props.tags).not.toHaveProperty('maxItems')
    const item = (props.tags.items ?? {}) as Record<string, unknown>
    expect(item.additionalProperties).toBe(false)
    expect(item.required).toEqual(['name', 'weight'])
    expect((item.properties as Record<string, unknown>).weight).toEqual({ type: 'number' })
    expect(props.kind.enum).toEqual(['email', 'form'])
    expect(props.fixed).toEqual({ type: 'string', enum: ['v1'] })
  })

  it('keeps nullable fields nullable', () => {
    const { schema: s, strict } = toOpenAiStrictSchema(zodToJsonSchema(z.object({ note: z.string().nullable() })))
    expect(strict).toBe(true)
    const note = (s.properties as Record<string, Record<string, unknown>>).note
    expect(JSON.stringify(note)).toContain('null')
  })

  it('reports schemas strict mode cannot express', () => {
    expect(toOpenAiStrictSchema(zodToJsonSchema(z.object({ counts: z.record(z.string(), z.number()) }))).strict).toBe(false)
    expect(toOpenAiStrictSchema(zodToJsonSchema(z.object({ anything: z.unknown() }))).strict).toBe(false)
    expect(toOpenAiStrictSchema(zodToJsonSchema(z.array(z.string()))).strict).toBe(false)
  })

  it('turns oneOf into anyOf', () => {
    const { schema: s } = toOpenAiStrictSchema({ type: 'object', properties: { v: { oneOf: [{ type: 'string' }, { type: 'number' }] } }, required: ['v'] })
    expect((s.properties as Record<string, Record<string, unknown>>).v).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] })
  })
})

describe('schema helpers', () => {
  it('stripNulls drops null values deeply so optional zod fields parse', () => {
    const schema = z.object({ a: z.string(), b: z.string().optional(), c: z.array(z.object({ d: z.number().optional() })) })
    const raw = { a: 'x', b: null, c: [{ d: null }] }
    expect(schema.safeParse(raw).success).toBe(false)
    expect(schema.safeParse(stripNulls(raw)).success).toBe(true)
  })

  it('jsonInstruction puts the schema in the prompt without defaults', () => {
    const text = jsonInstruction(zodToJsonSchema(z.object({ n: z.number().default(3) })))
    expect(text).toContain('JSON')
    expect(text).toContain('"n"')
    expect(text).not.toContain('default')
  })
})
