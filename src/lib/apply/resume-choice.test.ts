import { describe, expect, it } from 'vitest'
import type { AnswerBank } from './answer-bank'
import { isDocumentChoice, pickResumeOption, resolveStandard, type StandardContext } from './standard'
import type { ScannedField } from './types'

// LinkedIn Easy Apply's resume step, as the agent scanned it.
const COVER = 'PDF Alex-Rivera-Cover-Letter-Tappz-GmbH.pdf 10/30/2026'
const CV = 'PDF Alex-Rivera-CV.pdf 10/29/2026'

const bank: AnswerBank = { rows: [], std: () => null, lookup: () => null }
const ctx = { bank, email: 'a@example.org', fullName: 'Alex Rivera', resumePath: 'L:/x/Alex-Rivera-Lead-Software-Engineer-CV.pdf', coverLetterPath: null } as unknown as StandardContext

function radio(value: string, options: string[]): ScannedField {
  return { key: 'r1', kind: 'radio', label: options[0], name: 'jobsDocumentCardToggle', id: '', placeholder: '', required: true, value, options: options.map((o) => ({ label: o, value: o })), accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: 'Resume', hint: '' } as ScannedField
}

describe('choosing the resume among uploaded documents', () => {
  it('recognises a list of documents', () => {
    expect(isDocumentChoice([COVER, CV])).toBe(true)
    expect(isDocumentChoice(['Yes', 'No'])).toBe(false)
  })

  it('picks the CV, never the cover letter LinkedIn pre-selects', () => {
    expect(pickResumeOption([COVER, CV], 'Alex-Rivera-Lead-Software-Engineer-CV.pdf')).toBe(CV)
    expect(pickResumeOption([COVER], 'cv.pdf')).toBeNull()
    expect(pickResumeOption(['PDF Alex-Rivera-Lead-Software-Engineer-CV.pdf 10/30/2026', CV], 'Alex-Rivera-Lead-Software-Engineer-CV.pdf')).toBe('PDF Alex-Rivera-Lead-Software-Engineer-CV.pdf 10/30/2026')
  })

  it('answers the radio group with the CV, and stops for the user when only cover letters are offered', () => {
    expect(resolveStandard(radio(COVER, [COVER, CV]), ctx)).toEqual({ type: 'value', value: CV, source: 'rule' })
    expect(resolveStandard(radio(COVER, [COVER]), ctx)?.type).toBe('pending')
  })
})
