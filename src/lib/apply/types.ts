/** Shared types of the browser apply agent (see plan-browser-apply.md). */

export type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'password'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'checkboxes'
  | 'file'
  | 'combobox'
  | 'listbox'
  | 'buttons'

export interface FieldOption {
  label: string
  /** data-jf-key of the element to click/check for this option (radio, checkbox, button). */
  key?: string
  value?: string
}

/** One question/input on the page, as read by the in-page scanner. */
export interface ScannedField {
  key: string
  kind: FieldKind
  label: string
  name: string
  id: string
  placeholder: string
  required: boolean
  value: string
  options: FieldOption[]
  accept: string
  multiple: boolean
  maxLength: number | null
  visible: boolean
  disabled: boolean
  /** Nearest section heading, e.g. "Voluntary Self-Identification". */
  section: string
  /** data-automation-id / data-qa / data-ui / data-testid hint (Workday, Lever, Workable). */
  hint: string
  /** Comboboxes whose options appear only after typing (location search). */
  asyncOptions?: boolean
  /** Index of the frame the field lives in (filled in on the Node side). */
  frame?: number
  /** Error message shown next to the field, if any. */
  error?: string
}

export type ButtonKind = 'submit' | 'next' | 'back' | 'apply' | 'login' | 'signup' | 'other'

export interface ScannedButton {
  key: string
  text: string
  kind: ButtonKind
  tag: string
  href: string
  visible: boolean
  disabled: boolean
  frame?: number
}

export interface CaptchaInfo {
  kind: 'recaptcha' | 'hcaptcha' | 'turnstile' | 'text'
  /** True when a person has to act (challenge or checkbox shown), not just an invisible badge. */
  challengeVisible: boolean
}

export interface FrameScan {
  url: string
  title: string
  fields: ScannedField[]
  buttons: ScannedButton[]
  headings: string[]
  textSample: string
  hasPassword: boolean
  captcha: CaptchaInfo | null
  successText: string | null
  errors: string[]
  codePrompt: boolean
}

/** All frames of the current page merged. */
export interface PageScan extends FrameScan {
  frames: number
}

export type AnswerSource = 'profile' | 'bank' | 'rule' | 'ai' | 'cover_letter' | 'resume' | 'photo' | 'cached'

/** What the agent decided to put in one field. */
export interface PlannedAnswer {
  key: string
  label: string
  kind: FieldKind
  /** Text to type, or the option label to choose. Empty string = clear / leave. */
  value: string
  /** Several options (checkbox groups, multi-selects). */
  choices?: string[]
  /** Checkbox state for single checkboxes. */
  checked?: boolean
  /** Path of a file to upload. */
  file?: string
  /** Searchable dropdowns: what to try next when `value` finds no option (the city, then its country, then its region such as "EMEA"). */
  fallbacks?: string[]
  /** A searched option must name this too (the country for a place search). */
  within?: string
  source: AnswerSource
  required: boolean
  confidence?: number
}

export interface OpenQuestion {
  label: string
  kind: FieldKind
  options: string[]
  required: boolean
  reason: string
  /** Set when the answer is one of your standard details (std:notice_period...): answering it fills that detail. */
  stdKey?: string
}

export type AttemptStatus = 'QUEUED' | 'RUNNING' | 'AWAITING_REVIEW' | 'SUBMITTED' | 'NEEDS_HUMAN' | 'FAILED' | 'CANCELLED'
export type AttemptMode = 'fill' | 'submit'

export interface StepLog {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}
