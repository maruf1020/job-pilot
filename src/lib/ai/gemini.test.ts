import { describe, expect, it } from 'vitest'
import { parseModelJson } from './gemini'

describe('parseModelJson', () => {
  it('parses plain and fenced JSON', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseModelJson('```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] })
    expect(parseModelJson('Sure! {"a":1} hope that helps')).toEqual({ a: 1 })
  })
  it('recovers a truncated items array by dropping the incomplete element', () => {
    const truncated = '{"items":[{"id":"a","fit":80,"reasons":["x"]},{"id":"b","fit":70,"reasons":["y"]},{"id":"c","fit":6'
    expect(parseModelJson(truncated)).toEqual({ items: [{ id: 'a', fit: 80, reasons: ['x'] }, { id: 'b', fit: 70, reasons: ['y'] }] })
  })
  it('repairs raw line breaks inside string values', () => {
    const body = '{"subject":"Hi","body":"Hi team,\n\nFirst paragraph.\n\nSecond \\"quoted\\" line.\n\nAlex"}'
    expect(parseModelJson(body)).toEqual({ subject: 'Hi', body: 'Hi team,\n\nFirst paragraph.\n\nSecond "quoted" line.\n\nAlex' })
  })
  it('throws when nothing can be recovered', () => {
    expect(() => parseModelJson('not json at all')).toThrow()
  })
})
