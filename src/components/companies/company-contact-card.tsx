'use client'

import { useState } from 'react'
import { Mail, Search } from 'lucide-react'
import { Section } from '@/components/shared/section'
import { ToneBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { api, useApiMutation } from '@/lib/api/hooks'
import { fmtAgo, fmtDateTime } from '@/lib/format'
import type { CompanyBase } from './types'

interface ContactResult {
  email: string | null
  source: string | null
  candidates: string[]
  domain: string | null
  notes: string[]
  jobsUpdated: number
}

const SOURCE_LABEL: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'muted' }> = {
  verified: { label: 'verified mailbox', tone: 'success' },
  website: { label: 'found on the company site', tone: 'info' },
  search: { label: 'found by web search', tone: 'info' },
  posting: { label: 'from a posting', tone: 'info' },
  company: { label: 'company record', tone: 'muted' },
  manual: { label: 'entered by hand', tone: 'muted' },
  guessed: { label: 'guessed, not verified', tone: 'warning' },
}

/** Application address for the company: what we have, where it came from, and a button to (re)run the lookup. */
export function CompanyContactCard({ company }: { company: CompanyBase }) {
  const [last, setLast] = useState<ContactResult | null>(null)
  const find = useApiMutation<void, ContactResult>(() => api.post(`/api/companies/${company.id}/find-contact`), {
    invalidate: [['companies'], ['jobs']],
    onSuccess: (data) => setLast(data),
  })
  const source = company.contactEmailSource ? SOURCE_LABEL[company.contactEmailSource] : null

  return (
    <Section id="contact" title="Application email" description="Used for this company's jobs when a posting has no address of its own.">
      <div className="flex flex-col gap-3 text-sm">
        {company.contactEmail ? (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-2 font-medium break-all text-foreground">
              <Mail className="size-3.5 shrink-0 text-muted-foreground" /> {company.contactEmail}
            </p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {source ? <ToneBadge tone={source.tone}>{source.label}</ToneBadge> : null}
              {company.contactCheckedAt ? <span title={fmtDateTime(company.contactCheckedAt)}>checked {fmtAgo(company.contactCheckedAt)}</span> : null}
            </p>
            {company.contactCandidates.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Fallbacks if it bounces: <span className="break-all">{company.contactCandidates.join(', ')}</span>
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground">
            No address yet.
            {company.contactCheckedAt ? ` The last lookup (${fmtAgo(company.contactCheckedAt)}) found nothing.` : ''}
            {!company.domain ? ' Set the company domain in the profile so its website and mail server can be checked.' : ''}
          </p>
        )}

        {company.contactNotes ? <p className="rounded-md bg-muted p-2.5 text-xs wrap-break-word text-muted-foreground">{company.contactNotes}</p> : null}

        {last && !company.contactNotes && last.notes.length ? (
          <ul className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
            {last.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}

        <Button size="sm" variant="outline" className="w-full" disabled={find.isPending} onClick={() => find.mutate()}>
          <Search className="size-3.5" /> {find.isPending ? 'Looking up…' : company.contactEmail ? 'Look up again' : 'Find application email'}
        </Button>
        <p className="text-xs text-muted-foreground">Checks the website, web search and verified pattern guesses against the mail server. Takes 10 to 60 seconds.</p>
      </div>
    </Section>
  )
}
