/** A reply in the inbox lists (GET /api/inbox/needs-action: needsYou, nextSteps, locationIssue). */
export interface ReplyItem {
  messageId: string
  applicationId: string
  classification: string
  from: string
  subject: string
  receivedAt: string
  summary: string | null
  suggestedNextAction?: string | null
  applyUrl?: string | null
  contact: { name: string; email: string | null; role?: string | null } | null
  questions: string[]
  proposedTimes: string[]
  job: { id: string; title: string; companyName: string; countryCode: string | null; url?: string; atsType?: string | null }
  status?: string
  /** Leads only: you replied after it arrived, or marked it done. */
  answered?: boolean
  /** Leads only: an AI reply is drafted and waits for your review. */
  hasDraft?: boolean
}

export interface WaitingItem {
  applicationId: string
  to: string
  sentAt: string
  ageDays: number
  job: { id: string; title: string; companyName: string; countryCode: string | null }
  status: string
}

export interface NeedsActionData {
  needsYou: ReplyItem[]
  waitingForThem: WaitingItem[]
  nextSteps: ReplyItem[]
  locationIssue: ReplyItem[]
}
