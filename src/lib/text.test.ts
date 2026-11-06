import { describe, expect, it } from 'vitest'
import { toPlainText } from './text'

describe('toPlainText', () => {
  it('turns HTML into paragraphs and list lines', () => {
    expect(toPlainText('<p>Build <strong>things</strong>.</p><ul><li>TypeScript</li><li>AWS</li></ul>')).toBe('Build things .\n- TypeScript\n- AWS')
  })
  it('handles HTML that a feed escaped twice', () => {
    const escaped = '&lt;p&gt;&lt;span data-ccp-props=&quot;{}&quot;&gt;Hands-on&amp;nbsp;role&lt;/span&gt;&lt;/p&gt;&lt;p&gt;Second&lt;/p&gt;'
    const text = toPlainText(escaped)
    expect(text).not.toMatch(/<|&lt;|data-ccp/)
    expect(text).toBe('Hands-on role\nSecond')
  })
  it('leaves plain text alone apart from entities', () => {
    expect(toPlainText('Salary &euro;60k &amp; relocation')).toBe('Salary €60k & relocation')
  })
})
