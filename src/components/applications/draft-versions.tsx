'use client'

import { fmtAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ToneBadge } from '@/components/shared/status-badge'
import { aiTone } from './helpers'
import type { DraftDetail } from './types'

function PassBadge({ passed }: { passed: boolean }) {
  return <ToneBadge tone={passed ? 'success' : 'danger'}>{passed ? '✓ passed' : '✗ failed'}</ToneBadge>
}

interface DraftVersionsProps {
  drafts: DraftDetail[]
  /** The version currently loaded in the editor. */
  editorDraftId: string | null
  /** Load a version into the editor (no server call). */
  onLoad: (draft: DraftDetail) => void
  /** Mark a version as the one to send (`select-draft`). */
  onUse: (draft: DraftDetail) => void
  busyDraftId?: string | null
}

export function DraftVersions({ drafts, editorDraftId, onLoad, onUse, busyDraftId }: DraftVersionsProps) {
  if (drafts.length === 0) {
    return <p className="text-sm text-muted-foreground">No versions yet. Generation may still be running, or write one in the editor and save it.</p>
  }
  return (
    <ul className="flex flex-col gap-2">
      {drafts.map((d) => {
        const inEditor = d.id === editorDraftId
        const ai = d.judgeResult?.aiLikelihood
        const busy = busyDraftId === d.id
        return (
          <li
            key={d.id}
            className={cn('rounded-lg border p-2.5 text-sm transition-colors', d.isSelected && 'border-primary/40 bg-primary-soft', inEditor && 'ring-2 ring-ring/40')}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => onLoad(d)} className="font-semibold tabular-nums hover:underline">
                v{d.version}
              </button>
              <PassBadge passed={d.passed} />
              {ai != null ? <ToneBadge tone={aiTone(ai)}>AI {Math.round(ai)}%</ToneBadge> : null}
              {d.isSelected ? <ToneBadge tone="accent">Selected</ToneBadge> : null}
              <span className="ml-auto text-xs text-muted-foreground">{fmtAgo(d.createdAt)}</span>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {d.generatedBy ?? 'unknown'} · {d.subject}
            </p>
            {d.feedback ? <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">Feedback: {d.feedback}</p> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="xs" variant={inEditor ? 'secondary' : 'ghost'} onClick={() => onLoad(d)} disabled={inEditor}>
                {inEditor ? 'In editor' : 'Open in editor'}
              </Button>
              {!d.isSelected ? (
                <Button size="xs" variant="outline" onClick={() => onUse(d)} disabled={busy}>
                  {busy ? 'Selecting…' : 'Use this'}
                </Button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Read-only list of `follow_up` drafts. Renders nothing when there are none. */
export function FollowUpDrafts({ drafts }: { drafts: DraftDetail[] }) {
  if (drafts.length === 0) return null
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Follow-up drafts</CardTitle>
        <CardDescription>Generated automatically when no reply arrives. Read-only.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {drafts.map((d) => (
          <div key={d.id} className={cn('rounded-lg border p-2.5 text-sm', d.isSelected && 'border-primary/40 bg-primary-soft')}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold tabular-nums">v{d.version}</span>
              <PassBadge passed={d.passed} />
              {d.isSelected ? <ToneBadge tone="accent">Selected</ToneBadge> : null}
              <span className="ml-auto text-xs text-muted-foreground">{fmtAgo(d.createdAt)}</span>
            </div>
            <p className="mt-1 font-medium">{d.subject}</p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs text-muted-foreground">{d.body}</pre>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
