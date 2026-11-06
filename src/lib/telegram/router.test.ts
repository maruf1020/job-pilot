import { describe, expect, it } from 'vitest'
import { escapeMarkdownV2, lightMarkdownToV2, splitMessage } from './format'
import { parseMessage } from './router'

describe('parseMessage', () => {
  it('parses a command with arguments', () => {
    expect(parseMessage('/job  acme   senior dev')).toEqual({ kind: 'command', name: 'job', args: ['acme', 'senior', 'dev'], rest: 'acme   senior dev' })
  })

  it('lowercases the name and accepts a bare command', () => {
    expect(parseMessage('/Status')).toEqual({ kind: 'command', name: 'status', args: [], rest: '' })
  })

  it('strips the @botname suffix when it is this bot and ignores another bot', () => {
    expect(parseMessage('/notify@MyBot on', 'mybot')).toEqual({ kind: 'command', name: 'notify', args: ['on'], rest: 'on' })
    expect(parseMessage('/notify@OtherBot on', 'mybot')).toEqual({ kind: 'other-bot' })
    expect(parseMessage('/status@AnyBot')).toMatchObject({ kind: 'command', name: 'status' })
  })

  it('treats anything that does not start with a slash as free text', () => {
    expect(parseMessage('how many applied today')).toEqual({ kind: 'text', text: 'how many applied today' })
    expect(parseMessage('hello /status')).toEqual({ kind: 'text', text: 'hello /status' })
    expect(parseMessage('/ 5')).toEqual({ kind: 'text', text: '/ 5' })
  })

  it('returns empty for blank or missing text', () => {
    expect(parseMessage('   ')).toEqual({ kind: 'empty' })
    expect(parseMessage(undefined)).toEqual({ kind: 'empty' })
  })
})

describe('Markdown-safe text', () => {
  it('escapes every MarkdownV2 special character', () => {
    expect(escapeMarkdownV2('A_B (x) 1.5 - ok!')).toBe('A\\_B \\(x\\) 1\\.5 \\- ok\\!')
  })

  it('keeps only **bold** and `code` as formatting', () => {
    expect(lightMarkdownToV2('**3 sent** by A_B')).toBe('*3 sent* by A\\_B')
    expect(lightMarkdownToV2('run `a.b`')).toBe('run `a.b`')
  })

  it('splits long text on line breaks under the limit', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n')
    const parts = splitMessage(text, 1000)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => p.length <= 1000)).toBe(true)
    expect(parts.join('\n')).toBe(text)
  })
})
