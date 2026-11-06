import { describe, expect, it } from 'vitest'
import { coverLetterStep, resolveStandard, type StandardContext } from './standard'
import type { ScannedField } from './types'

const ctx = (over: Partial<StandardContext> = {}): StandardContext => ({
  bank: { rows: [], std: () => null, lookup: () => null },
  email: 'a@example.org',
  fullName: 'Alex Rivera',
  yearsExperience: 5,
  coverLetter: 'Dear team',
  resumePath: 'cv.pdf',
  coverLetterPath: 'letter.pdf',
  coverLetterEverywhere: false,
  ...over,
})
// JOIN's box: labelled "Upload file", its input named like the CV box.
const box = (over: Partial<ScannedField> = {}): ScannedField => ({ key: 'f', kind: 'file', label: 'Upload file', name: 'cv', id: 'cv-upload', placeholder: '', required: false, value: '', options: [], accept: '', multiple: false, maxLength: null, visible: true, disabled: false, section: '', hint: 'cv-dropzone', ...over })

describe('coverLetterStep', () => {
  it("knows JOIN's cover letter step by its heading or its address", () => {
    expect(coverLetterStep({ url: 'https://join.com/companies/xheroncom/16706729/apply/coverLetter', headings: ['Upload your cover letter'] })).toBe('Upload your cover letter')
    expect(coverLetterStep({ url: 'https://join.com/companies/songpush/16743472/apply/coverLetter', headings: ['WePush'] })).toBe('Cover letter')
  })

  it('is no cover letter step when the page is about the CV', () => {
    expect(coverLetterStep({ url: 'https://join.com/companies/x/1/apply/cv', headings: ['Upload your CV'] })).toBeNull()
    expect(coverLetterStep({ url: 'https://acme.com/jobs/1', headings: ['CV and cover letter'] })).toBeNull()
    expect(coverLetterStep({ url: 'https://acme.com/discover/jobs/1', headings: ['Discover our team'] })).toBeNull()
  })
})

describe('upload box on a cover letter step', () => {
  it('gets the cover letter, never the CV, even when the input is named cv', () => {
    expect(resolveStandard(box({ section: 'Upload your cover letter' }), ctx())).toEqual({ type: 'file', path: 'letter.pdf', source: 'cover_letter' })
  })

  it('stays empty without a letter file rather than taking the CV', () => {
    expect(resolveStandard(box({ section: 'Upload your cover letter' }), ctx({ coverLetterPath: null }))).toMatchObject({ type: 'skip' })
  })

  it('still gives the CV to a box that itself says CV', () => {
    expect(resolveStandard(box({ label: 'Upload your CV', section: 'Upload your cover letter' }), ctx())).toEqual({ type: 'file', path: 'cv.pdf', source: 'resume' })
  })
})
