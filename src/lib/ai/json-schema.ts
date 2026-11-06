import { z } from 'zod'

/**
 * JSON schema helpers shared by the adapters: the zod -> JSON schema conversion, the strict
 * variant OpenAI-style structured outputs need, and the schema-in-the-prompt fallback for
 * providers without a native schema mode.
 */

/** Draft-7 JSON schema of a zod schema (no $schema key). */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, unknown>
  delete json.$schema
  return json
}

// Keywords strict structured outputs reject (or that only some providers accept): dropped, the zod parse still checks them.
const DROP_KEYS = new Set([
  '$schema',
  '$id',
  'default',
  'examples',
  'format',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'propertyNames',
  'patternProperties',
  'contentEncoding',
  'contentMediaType',
  'readOnly',
  'writeOnly',
  'deprecated',
])

type Json = Record<string, unknown>

function isObj(v: unknown): v is Json {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function nullable(s: unknown): Json {
  if (!isObj(s)) return { anyOf: [s, { type: 'null' }] }
  if (Array.isArray(s.anyOf)) return (s.anyOf as Json[]).some((x) => isObj(x) && x.type === 'null') ? s : { ...s, anyOf: [...(s.anyOf as Json[]), { type: 'null' }] }
  if (Array.isArray(s.enum)) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === 'string' ? [s.type] : []
    return { ...s, enum: s.enum.includes(null) ? s.enum : [...s.enum, null], ...(types.length ? { type: [...new Set([...types, 'null'])] } : {}) }
  }
  if (typeof s.type === 'string') return { ...s, type: [s.type, 'null'] }
  if (Array.isArray(s.type)) return s.type.includes('null') ? s : { ...s, type: [...s.type, 'null'] }
  return { anyOf: [s, { type: 'null' }] }
}

function walk(node: unknown, ctx: { strict: boolean }): unknown {
  if (Array.isArray(node)) return node.map((n) => walk(n, ctx))
  if (!isObj(node)) return node
  const out: Json = {}
  for (const [k, v] of Object.entries(node)) {
    if (DROP_KEYS.has(k) || k === 'additionalProperties' || k === 'required') continue
    if (k === 'properties' || k === 'definitions' || k === '$defs') {
      out[k] = isObj(v) ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, walk(pv, ctx)])) : v
      continue
    }
    if (k === 'oneOf') {
      out.anyOf = walk(v, ctx)
      continue
    }
    if (k === 'const') {
      out.enum = [v]
      continue
    }
    out[k] = walk(v, ctx)
  }
  if ('allOf' in out || 'not' in out || 'if' in out) ctx.strict = false
  const typeList = Array.isArray(out.type) ? (out.type as string[]) : typeof out.type === 'string' ? [out.type] : []
  const isObject = typeList.includes('object') || isObj(out.properties)
  if (isObject) {
    const props = isObj(out.properties) ? (out.properties as Json) : {}
    // A record (z.record) has no fixed keys: strict mode cannot express it.
    if (isObj(node.additionalProperties) || (node.additionalProperties === true && Object.keys(props).length === 0) || (!isObj(node.properties) && node.additionalProperties !== false)) {
      ctx.strict = false
      if (isObj(node.additionalProperties)) out.additionalProperties = walk(node.additionalProperties, ctx)
      return out
    }
    const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : [])
    for (const key of Object.keys(props)) if (!required.has(key)) props[key] = nullable(props[key])
    out.properties = props
    out.required = Object.keys(props)
    out.additionalProperties = false
    return out
  }
  // An untyped node ("any") is not allowed in strict mode.
  const typed = typeList.length > 0 || 'anyOf' in out || 'enum' in out || '$ref' in out || 'items' in out
  if (!typed) ctx.strict = false
  return out
}

/**
 * OpenAI structured outputs (strict): every object closed (additionalProperties false), every
 * property required (optional ones become nullable), unsupported keywords dropped. `strict` is
 * false when the schema cannot be expressed that way (records, "any" values, a non-object root);
 * callers then fall back to JSON mode with the schema in the prompt.
 */
export function toOpenAiStrictSchema(jsonSchema: Record<string, unknown>): { schema: Record<string, unknown>; strict: boolean } {
  const ctx = { strict: true }
  const schema = walk(jsonSchema, ctx) as Record<string, unknown>
  if (schema.type !== 'object') ctx.strict = false
  return { schema, strict: ctx.strict }
}

/** The schema as text for the prompt (no defaults or $schema noise). */
export function schemaForPrompt(jsonSchema: Record<string, unknown>): string {
  const strip = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(strip)
    if (!isObj(n)) return n
    return Object.fromEntries(Object.entries(n).filter(([k]) => k !== '$schema' && k !== 'default').map(([k, v]) => [k, strip(v)]))
  }
  return JSON.stringify(strip(jsonSchema))
}

/** Prompt suffix for keys without a native schema mode. */
export function jsonInstruction(jsonSchema: Record<string, unknown>): string {
  return `\n\nAnswer with one JSON value only (no prose, no code fence) that matches this JSON schema:\n${schemaForPrompt(jsonSchema)}`
}

/**
 * Drop null values from objects (deep). Strict structured outputs send null for optional fields
 * the model left out, which `z.string().optional()` rejects; the zod parse retries on this copy.
 */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls)
  if (!isObj(value)) return value
  const out: Json = {}
  for (const [k, v] of Object.entries(value)) if (v !== null) out[k] = stripNulls(v)
  return out
}
