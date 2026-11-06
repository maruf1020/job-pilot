import { describe, expect, it } from 'vitest'
import { namesByRef } from './driver'

describe('namesByRef', () => {
  it('reads refs inside iframes ("f2e15") so the safety checks see their names', () => {
    const n = namesByRef('- button "Submit" [ref=f2e15]\n- textbox "Email" [ref=e3]')
    expect(n.get('f2e15')?.name).toBe('Submit')
    expect(n.get('e3')?.name).toBe('Email')
  })
  it('labels a nameless element with the text above it', () => {
    const n = namesByRef('- text: Choose job location\n- generic [ref=e867] [cursor=pointer]')
    expect(n.get('e867')).toEqual({ role: 'generic', name: '', near: 'Choose job location' })
  })
})

describe('uploadsFirst', () => {
  it('moves file uploads to the front and keeps the rest in order', async () => {
    const { uploadsFirst } = await import('./driver')
    const acts = [{ type: 'fill', id: 1 }, { type: 'click', id: 2 }, { type: 'upload_cv', id: 3 }, { type: 'check', id: 4 }]
    expect(uploadsFirst(acts).map((a) => a.id)).toEqual([3, 1, 2, 4])
  })
})
