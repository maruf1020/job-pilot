/** Shapes returned by /api/runs (list) and /api/runs/[id] (detail). Dates are ISO strings. */

export interface RunSummary {
  id: string
  trigger: string
  status: string
  cancelRequested: boolean
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  totalFetched: number
  totalNew: number
  totalDuplicates: number
  totalFiltered: number
  totalEnriched: number
  totalRanked: number
  totalDrafted: number
  totalQueued: number
  errorCount: number
  errorDetails: unknown
  createdAt: string
  updatedAt: string
}

export interface RunRow extends RunSummary {
  _count: { sources: number; logs: number }
}

export interface RunSource {
  id: string
  runId: string
  source: string
  query: string | null
  country: string | null
  requests: number
  returned: number
  created: number
  duplicates: number
  errors: number
  durationMs: number
  error: string | null
  createdAt: string
}

export interface RunLog {
  id: string
  runId: string
  level: string
  message: string
  meta: unknown
  createdAt: string
}

export interface RunDetailPayload extends RunSummary {
  sources: RunSource[]
  logs: RunLog[]
}

export interface RunErrorDetail {
  step: string
  message: string
}

/** `errorDetails` is free-form JSON; normalise it into a list of {step, message}. */
export function parseErrorDetails(value: unknown): RunErrorDetail[] {
  if (!Array.isArray(value)) return []
  const out: RunErrorDetail[] = []
  for (const item of value) {
    if (typeof item === 'string') out.push({ step: '', message: item })
    else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>
      out.push({ step: typeof rec.step === 'string' ? rec.step : '', message: typeof rec.message === 'string' ? rec.message : JSON.stringify(rec) })
    }
  }
  return out
}
