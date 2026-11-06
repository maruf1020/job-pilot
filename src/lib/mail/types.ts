import type { MailFolder } from './folders'

/** One application in a mail folder list (GET /api/mail). */
export interface MailItem {
  applicationId: string
  company: string
  title: string
  countryCode: string | null
  status: string
  /** Who wrote last and what: the headline of the row. */
  subject: string
  /** One line under the headline (reply summary, recipient, hold reason). */
  preview: string
  /** The date the row is sorted by and shows as "x ago". */
  at: string
  /** Classification of the latest real reply, when there is one. */
  reply: string | null
  /** Latest real inbound message, for the reader actions. */
  messageId: string | null
  folders: MailFolder[]
  waitingUntil: string | null
  heldReason: string | null
}

export interface MailList {
  folder: MailFolder
  items: MailItem[]
  counts: Record<MailFolder, number>
}

export interface MailThreadMessage {
  id: string
  direction: 'INBOUND' | 'OUTBOUND'
  from: string
  to: string
  subject: string
  body: string
  at: string
  classification: string | null
  summary: string | null
}

export interface MailThread {
  applicationId: string
  company: string
  title: string
  countryCode: string | null
  status: string
  toEmail: string | null
  notes: string | null
  folders: MailFolder[]
  waitingUntil: string | null
  heldReason: string | null
  messages: MailThreadMessage[]
  /** The draft that would go out (or went out), when no message exists yet. */
  draft: { subject: string; body: string; passed: boolean } | null
  /** The latest real inbound message (to change its type or mark it done), if any. */
  latestReplyId: string | null
  latestReplyClassification: string | null
}
