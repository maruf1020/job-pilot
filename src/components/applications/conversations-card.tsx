'use client'

import { useState } from 'react'
import { ExternalLink, Maximize2, MessagesSquare, Plus, Trash2 } from 'lucide-react'
import { api, useApiMutation } from '@/lib/api/hooks'
import type { HiringConversation } from '@/lib/applications/conversations'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmButton } from '@/components/shared/confirm-button'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?'

/** Text with links made clickable; line breaks kept. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g)
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  )
}

/** The chat itself: the company on the left, your answers on the right, system lines in the middle. */
const isQuestionMessage = (m: HiringConversation['messages'][number]) => m.role === 'them' && /\?\s*$/.test(m.text.trim())

/** The number of each question the company asked (1, 2, 3...), by message index. */
function questionNumbers(messages: HiringConversation['messages']): Map<number, number> {
  const out = new Map<number, number>()
  messages.forEach((m, i) => {
    if (isQuestionMessage(m)) out.set(i, out.size + 1)
  })
  return out
}

function Transcript({ conversation, company }: { conversation: HiringConversation; company: string }) {
  const numbers = questionNumbers(conversation.messages)
  return (
    <ol className="flex flex-col gap-3">
      {conversation.messages.map((m, i) => {
        if (m.role === 'note') {
          return (
            <li key={i} className="flex justify-center">
              <span className="rounded-full border bg-muted px-3 py-1 text-xs text-muted-foreground">
                <RichText text={m.text} />
              </span>
            </li>
          )
        }
        const mine = m.role === 'me'
        const question = numbers.get(i)
        const isQuestion = question !== undefined
        return (
          <li key={i} className={cn('flex items-end gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
            <span
              aria-hidden
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                mine ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground ring-1 ring-border',
              )}
            >
              {mine ? 'ME' : initials(company)}
            </span>
            <div className={cn('flex max-w-[85%] flex-col gap-1', mine ? 'items-end' : 'items-start')}>
              {isQuestion ? <span className="px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Question {question}</span> : null}
              <div
                className={cn(
                  'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-xs',
                  mine ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border bg-card',
                  isQuestion && 'font-medium',
                )}
              >
                <RichText text={m.text} />
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Fields({ fields }: { fields: HiringConversation['fields'] }) {
  if (!fields.length) return null
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Form you filled in the chat</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="break-words">{f.value || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function ConversationHeader({ c }: { c: HiringConversation }) {
  const asked = c.messages.filter(isQuestionMessage).length
  const answered = c.messages.filter((m) => m.role === 'me').length
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{c.title}</span>
        <Badge variant={c.status === 'open' ? 'default' : 'outline'}>{c.status === 'open' ? 'Open' : 'Closed'}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {[c.channel, c.happenedAt ? (/^\d{4}-\d{2}-\d{2}$/.test(c.happenedAt) ? fmtDate(`${c.happenedAt}T12:00:00`) : fmtDateTime(c.happenedAt)) : null,`${asked} question${asked === 1 ? '' : 's'}, ${answered} answer${answered === 1 ? '' : 's'}`]
          .filter(Boolean)
          .join(' · ')}
        {c.url ? (
          <>
            {' · '}
            <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
              Open <ExternalLink className="size-3" />
            </a>
          </>
        ) : null}
      </p>
      {c.summary ? <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs">{c.summary}</p> : null}
    </div>
  )
}

function AddConversationDialog({ applicationId, invalidate }: { applicationId: string; invalidate: unknown[][] }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [channel, setChannel] = useState('')
  const [raw, setRaw] = useState('')
  const save = useApiMutation((vars: { title: string; channel: string; raw: string }) => api.post(`/api/applications/${applicationId}/conversations`, { title: vars.title, channel: vars.channel || null, raw: vars.raw }), {
    invalidate,
    successMessage: 'Conversation saved',
    onSuccess: () => {
      setOpen(false)
      setTitle('')
      setChannel('')
      setRaw('')
    },
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus /> Add conversation
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Save a hiring conversation</DialogTitle>
          <DialogDescription>Paste the whole chat. The AI only decides who said what; every word is kept as written.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conv-title">Title</Label>
              <Input id="conv-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Async hiring chat" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conv-channel">Where</Label>
              <Input id="conv-channel" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Company hiring chat, video call..." />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conv-raw">Conversation</Label>
            <Textarea id="conv-raw" value={raw} onChange={(e) => setRaw(e.target.value)} rows={14} placeholder="Paste the full conversation here" />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!title.trim() || !raw.trim() || save.isPending} onClick={() => save.mutate({ title: title.trim(), channel: channel.trim(), raw })}>
            {save.isPending ? 'Reading the chat…' : 'Save conversation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Hiring chats and interviews kept word for word on the application. */
export function ConversationsCard({
  applicationId,
  company,
  conversations,
  invalidate,
}: {
  applicationId: string
  company: string
  conversations: HiringConversation[]
  invalidate: unknown[][]
}) {
  const remove = useApiMutation((conversationId: string) => api.delete(`/api/applications/${applicationId}/conversations?conversationId=${encodeURIComponent(conversationId)}`), {
    invalidate,
    successMessage: 'Conversation removed',
  })
  return (
    <Card id="conversations" className="scroll-mt-20">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <MessagesSquare className="size-4 text-primary" /> Hiring conversations
          </CardTitle>
          <CardDescription>
            {conversations.length
              ? `${conversations.length} saved, every question and answer word for word`
              : 'Keep chat interviews and screenings here, question by question.'}
          </CardDescription>
        </div>
        <AddConversationDialog applicationId={applicationId} invalidate={invalidate} />
      </CardHeader>
      {conversations.length ? (
        <CardContent className="flex flex-col gap-6">
          {conversations.map((c) => (
            <section key={c.id} className="flex flex-col gap-3 rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <ConversationHeader c={c} />
                <div className="flex shrink-0 gap-1">
                  <Dialog>
                    <DialogTrigger render={<Button size="sm" variant="ghost" aria-label="Full screen" />}>
                      <Maximize2 />
                    </DialogTrigger>
                    <DialogContent className="flex h-[92vh] flex-col sm:max-w-4xl">
                      <DialogHeader>
                        <DialogTitle>{c.title}</DialogTitle>
                        <DialogDescription>{[company, c.channel].filter(Boolean).join(' · ')}</DialogDescription>
                      </DialogHeader>
                      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
                        {c.summary ? <p className="rounded-md bg-muted px-3 py-2 text-sm">{c.summary}</p> : null}
                        <Transcript conversation={c} company={company} />
                        <Fields fields={c.fields} />
                      </div>
                    </DialogContent>
                  </Dialog>
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    aria-label="Remove conversation"
                    title="Remove this conversation?"
                    description="It is deleted from this application. The company's own copy is not affected."
                    confirmLabel="Remove"
                    onConfirm={() => remove.mutateAsync(c.id)}
                  >
                    <Trash2 />
                  </ConfirmButton>
                </div>
              </div>
              <div className="max-h-[36rem] overflow-y-auto rounded-lg bg-muted/30 p-3">
                <Transcript conversation={c} company={company} />
              </div>
              <Fields fields={c.fields} />
            </section>
          ))}
        </CardContent>
      ) : null}
    </Card>
  )
}
