import { describe, expect, it } from 'vitest'
import { quickCommand } from './panel-commands'

describe('quickCommand', () => {
  it('reads the quick buttons', () => {
    expect(quickCommand('/close')).toEqual({ command: 'close_tab', args: {} })
    expect(quickCommand('/later')).toEqual({ command: 'later', args: {} })
    expect(quickCommand('/later: record the Loom video')).toEqual({ command: 'later', args: { note: 'record the Loom video' } })
    expect(quickCommand('/submitted')).toEqual({ command: 'mark_submitted', args: {} })
    expect(quickCommand('/skip')).toEqual({ command: 'skip_job', args: {} })
  })
  it('takes a short "close this tab" without the AI (it once said it could not)', () => {
    expect(quickCommand('close this tab now')?.command).toBe('close_tab')
    expect(quickCommand('Close tab')?.command).toBe('close_tab')
    expect(quickCommand('please close the tab')?.command).toBe('close_tab')
  })
  it('leaves everything else to the chat', () => {
    expect(quickCommand('close the cookie banner and pick Portugal')).toBeNull()
    expect(quickCommand('will do this later, I have to prepare a video')).toBeNull()
    expect(quickCommand('what is left?')).toBeNull()
  })
})

describe('opening a clean Chrome', () => {
  it('takes the button and plain words', () => {
    expect(quickCommand('/clean')?.command).toBe('open_clean')
    expect(quickCommand('open a new separate chrome')?.command).toBe('open_clean')
    expect(quickCommand('please open it in a clean browser')?.command).toBe('open_clean')
    expect(quickCommand('the separate chrome window is slow')).toBeNull()
  })
})
