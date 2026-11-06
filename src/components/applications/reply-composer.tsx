'use client'

import { useState } from 'react'
import { Bot, CheckCheck, ExternalLink, Globe, Loader2, Reply, Send, Sparkles } from 'lucide-react'
import { api, useApiMutation } from '@/lib/api/hooks'
import { DECLINE_REPLY_INSTRUCTION, LOCATION_REPLY_INSTRUCTION } from '@/lib/domain'
import { fmtAgo } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { ReplyBadge } from '@/components/shared/status-badge'
import type { ActionVars, ApplicationDetail, MessageDetail } from './types'

const NOT_A_REPLY = new Set(['BOUNCE', 'AUTO_REPLY'])
const REDIRECTS = new Set(['APPLY_VIA_PORTAL', 'WRONG_RECIPIENT'])
/** Same rule as the Inbox "Waiting for them" list: no nudge after a redirect or a no. */
const NO_NUDGE = new Set(['APPLY_VIA_PORTAL', 'WRONG_RECIPIENT', 'REJECTION'])
const INVALIDATE: unknown[][] = [['applications'], ['inbox'], ['dashboard'], ['status']]

interface DraftResult {
  draftId: string
  to: string
  cc: string | null
  subject: string
  body: string
  attachCv: boolean
  missing: string[]
  lint: { passed: boolean; errors: Array<{ message: string }>; warnings: Array<{ message: string }> }
  inboundId: string
  model: string
}

/** The latest reply that still waits for an answer from you (nothing sent after it, not dismissed). */
export function pendingReply(app: ApplicationDetail): MessageDetail | null {
  const inbound = [...app.messages].reverse().find((m) => m.direction === 'INBOUND' && !NOT_A_REPLY.has(m.classification ?? ''))
  if (!inbound || inbound.handledAt) return null
  const at = inbound.receivedAt ?? inbound.createdAt
  const answered = app.messages.some((m) => m.direction === 'OUTBOUND' && (m.sentAt ?? m.createdAt) > at)
  return answered ? null : inbound
}

function senderEmail(from: string): string {
  const m = /<([^>]+)>/.exec(from)
  return (m ? m[1] : from).trim()
}

/**
 * Following up on a reply: what they want, an AI draft you can edit, and Send in the same
 * thread. Nothing goes out without your click.
 */
export function ReplyComposer({ app }: { app: ApplicationDetail }) {
  const pending = pendingReply(app)
  const latest = [...app.messages].reverse().find((m) => m.direction === 'INBOUND' && !NOT_A_REPLY.has(m.classification ?? '')) ?? null
  const target = pending ?? latest
  const meta = target?.classificationMeta ?? null
  // They answered once, you wrote last, and nothing came back: offer a nudge.
  const [now] = useState(() => Date.now())
  const lastMessage = app.messages.at(-1)
  const quietDays =
    !pending && latest && lastMessage?.direction === 'OUTBOUND' ? Math.floor((now - new Date(lastMessage.sentAt ?? lastMessage.createdAt).getTime()) / 86_400_000) : null
  const nudge = quietDays !== null && quietDays >= 4 && !NO_NUDGE.has(latest?.classification ?? '')
  // A reply already drafted for this message (e.g. from the Inbox) opens ready to review.
  const saved = pending
    ? (app.drafts.find((d) => d.kind === 'reply' && d.isSelected && d.createdAt > (pending.receivedAt ?? pending.createdAt)) ?? null)
    : null
  // "Apply on our site" and "wrong person" need the form, not an answer: the editor starts closed there.
  const [open, setOpen] = useState(Boolean(pending) && !REDIRECTS.has(pending?.classification ?? ''))
  const [to, setTo] = useState(meta?.contact?.email || (target ? senderEmail(target.fromAddress) : ''))
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(saved?.subject ?? (target ? (/^re:/i.test(target.subject) ? target.subject : `Re: ${target.subject}`) : ''))
  const [body, setBody] = useState(saved?.body ?? '')
  // A decline still earns a reply: other roles there (location) and a polite ask for a referral.
  const [instruction, setInstruction] = useState(
    target?.classification === 'LOCATION_ISSUE' ? LOCATION_REPLY_INSTRUCTION : target?.classification === 'REJECTION' ? DECLINE_REPLY_INSTRUCTION : '',
  )
  const [attach, setAttach] = useState(false)
  const [draft, setDraft] = useState<DraftResult | null>(null)

  const act = useApiMutation<ActionVars, DraftResult>((v) => api.post(`/api/applications/${app.id}/actions`, v), {
    invalidate: INVALIDATE,
    onSuccess: (d, env) => {
      if (!d || !('draftId' in d)) return
      setDraft(d)
      setTo(d.to)
      setCc(d.cc ?? '')
      setSubject(d.subject)
      setBody(d.body)
      setAttach(d.attachCv)
      void env
    },
  })
  const send = useApiMutation<ActionVars, { to: string }>((v) => api.post(`/api/applications/${app.id}/actions`, v), {
    invalidate: INVALIDATE,
    onSuccess: () => {
      setBody('')
      setDraft(null)
      setOpen(false)
    },
  })
  const openBrowser = useApiMutation<{ action: 'open'; url: string }, unknown>((v) => api.post('/api/browser', v))

  if (!target) return null
  const placeholder = /\[[^\]]{2,60}\]/.test(body)
  const canSend = Boolean(to.trim() && subject.trim() && body.trim()) && !placeholder
  const klass = target.classification ?? 'OTHER'

  return (
    <Card id="reply" className={pending ? 'border-warning/50' : undefined}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Reply className="size-4" /> {pending ? 'They replied: your move' : nudge ? `Quiet for ${quietDays} days` : 'Reply'}
          <ReplyBadge classification={klass} />
        </CardTitle>
        <CardDescription>
          {pending
            ? `${target.fromAddress} wrote ${fmtAgo(target.receivedAt ?? target.createdAt)}.`
            : nudge
              ? 'You wrote last and nothing came back. A short, polite nudge in the same thread is fine after about a week.'
              : 'Answer their last message in the same thread.'}
          {meta?.summary ? ` ${meta.summary}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {meta?.questions?.length ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">They ask for:</span>
            {meta.questions.map((q) => (
              <Badge key={q} variant="outline">
                {q}
              </Badge>
            ))}
          </div>
        ) : null}
        {meta?.proposedTimes?.length ? <p className="text-xs">Proposed times: {meta.proposedTimes.join(' · ')}</p> : null}
        {meta?.contact ? (
          <p className="text-xs">
            Now handled by <span className="font-medium">{meta.contact.name}</span>
            {meta.contact.role ? ` (${meta.contact.role})` : ''}
            {meta.contact.email ? ` · ${meta.contact.email}` : ''}
          </p>
        ) : null}
        {meta?.suggestedNextAction && pending ? <p className="text-xs text-muted-foreground">Suggested: {meta.suggestedNextAction}</p> : null}

        {klass === 'APPLY_VIA_PORTAL' || klass === 'WRONG_RECIPIENT' ? (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary-soft p-3 text-sm">
            <p className="font-medium">{klass === 'APPLY_VIA_PORTAL' ? 'They want the application on their website.' : 'This reached the wrong team; the application is not with recruiting yet.'}</p>
            <p className="text-xs text-muted-foreground">
              Use the &ldquo;Apply in browser&rdquo; card below: the agent fills their form and stops before Submit. A short thank-you reply is optional.
            </p>
            <div className="flex flex-wrap gap-2">
              {meta?.applyUrl ? (
                <>
                  <a href={meta.applyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline">
                    <ExternalLink className="size-3.5" /> {meta.applyUrl.replace(/^https?:\/\//, '').slice(0, 60)}
                  </a>
                  <Button size="xs" variant="outline" onClick={() => openBrowser.mutate({ action: 'open', url: meta.applyUrl! })} disabled={openBrowser.isPending}>
                    <Globe /> Open in apply browser
                  </Button>
                </>
              ) : null}
              {pending ? (
                <Button size="xs" variant="ghost" onClick={() => act.mutate({ action: 'mark-handled', messageId: target.id, handled: true })} disabled={act.isPending}>
                  <CheckCheck /> Done, I applied there
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!open ? (
          <div className="flex flex-wrap gap-2">
            {nudge ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setOpen(true)
                  act.mutate({ action: 'draft-reply', messageId: target.id, nudge: true })
                }}
                disabled={act.isPending}
              >
                {act.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Draft a nudge
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Reply /> Write a reply
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reply-to">To</Label>
                <Input id="reply-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reply-cc">Cc (optional)</Label>
                <Input id="reply-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="a@company.com, b@company.com" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reply-subject">Subject</Label>
              <Input id="reply-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reply-instruction">What should the reply say? (optional, for the AI draft)</Label>
              <Input id="reply-instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. accept Thursday 10:00, ask if the role sponsors a permit" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reply-body">Message</Label>
              <Textarea id="reply-body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-44 text-sm" placeholder="Press 'Draft with AI' or write it yourself." />
            </div>
            {draft?.missing.length ? (
              <p className="text-xs text-warning-text">Fill in before sending: {draft.missing.join(', ')} (marked [like this]). Save them once in Settings → Browser → Your answers and the next draft has them.</p>
            ) : null}
            {draft && (draft.lint.errors.length || draft.lint.warnings.length) ? (
              <p className="text-xs text-muted-foreground">
                Checks: {draft.lint.errors.map((e) => e.message).concat(draft.lint.warnings.map((w) => w.message)).slice(0, 4).join('; ')}
              </p>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={attach} onCheckedChange={(c) => setAttach(Boolean(c))} /> Attach my CV
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => act.mutate({ action: 'draft-reply', messageId: target.id, instruction: instruction || null, nudge })} disabled={act.isPending}>
                {act.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} {draft ? 'Draft again' : nudge ? 'Draft a nudge' : 'Draft with AI'}
              </Button>
              <ConfirmButton
                size="sm"
                disabled={!canSend || send.isPending}
                title={`Send this reply to ${to}?`}
                description={`It goes out now from your mailbox, in the same thread${attach ? ', with your CV attached' : ''}.`}
                confirmLabel="Send reply"
                onConfirm={() => send.mutateAsync({ action: 'send-reply', to, cc: cc || null, subject, body, attachResume: attach, messageId: target.id }).catch(() => null)}
              >
                <Send /> Send reply
              </ConfirmButton>
              {pending ? (
                <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: 'mark-handled', messageId: target.id, handled: true })} disabled={act.isPending}>
                  <CheckCheck /> No reply needed
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
            {placeholder ? <p className="text-xs text-danger-text">The message still has a [placeholder]; fill it in to send.</p> : null}
            <p className="text-xs text-muted-foreground">
              <Bot className="mr-1 inline size-3.5" /> The draft uses only your profile and saved answers; it never invents a salary, notice period or permit status.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
