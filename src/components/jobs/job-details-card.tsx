'use client'

import { useState } from 'react'
import { Save } from 'lucide-react'
import { KeyValue } from '@/components/shared/page-header'
import { Section } from '@/components/shared/section'
import { ChannelBadge, ToneBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, useApiMutation } from '@/lib/api/hooks'
import { fmtSalary, titleCase } from '@/lib/format'
import type { JobDetail } from './types'

const ADDRESS_SOURCE: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'muted' }> = {
  verified: { label: 'verified mailbox', tone: 'success' },
  website: { label: 'found on the company site', tone: 'info' },
  search: { label: 'found by web search', tone: 'info' },
  posting: { label: 'from the posting', tone: 'info' },
  'apply-page': { label: 'from the apply page', tone: 'info' },
  company: { label: 'company record', tone: 'muted' },
  manual: { label: 'entered by hand', tone: 'muted' },
  guessed: { label: 'guessed, not verified', tone: 'warning' },
}

function SkillList({ label, items, tone }: { label: string; items: string[]; tone: 'neutral' | 'muted' }) {
  if (items.length === 0) return null
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((s) => (
          <ToneBadge key={s} tone={tone} className="h-auto py-0.5 whitespace-normal">
            {s}
          </ToneBadge>
        ))}
      </div>
    </div>
  )
}

/** Keyed on the saved value by the parent so the local draft resets after a save. */
function ContactEmailEditor({ jobId, current }: { jobId: string; current: string | null }) {
  const [value, setValue] = useState(current ?? '')
  const save = useApiMutation<{ contactEmail: string | null }>((body) => api.patch(`/api/jobs/${jobId}`, body), {
    invalidate: [['jobs']],
    successMessage: 'Contact email saved',
  })
  const trimmed = value.trim()
  const dirty = trimmed !== (current ?? '')
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (dirty) save.mutate({ contactEmail: trimmed || null })
      }}
    >
      <Label htmlFor="job-contact-email">Contact email</Label>
      <div className="flex gap-2">
        <Input id="job-contact-email" type="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder="jobs@company.com" className="min-w-0 flex-1" />
        <Button type="submit" variant="outline" disabled={!dirty || save.isPending}>
          <Save className="size-4" /> {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">The recipient when this application goes out by email.</p>
    </form>
  )
}

/** Facts from the posting and enrichment, the contact address, and the skills the job asks for. */
export function JobDetailsCard({ job }: { job: JobDetail }) {
  const source = job.contactEmailSource ? ADDRESS_SOURCE[job.contactEmailSource] : null
  return (
    <Section title="Details">
      <div className="flex flex-col gap-5">
        <KeyValue
          items={[
            { label: 'Seniority', value: job.seniority ? titleCase(job.seniority) : '-' },
            { label: 'Apply channel', value: <ChannelBadge channel={job.applyChannel} /> },
            { label: 'ATS', value: job.atsType ? titleCase(job.atsType) : '-' },
            { label: 'Salary', value: fmtSalary(job.salaryMin, job.salaryMax, job.currency) },
            { label: 'Languages asked', value: job.requiredLanguages.length ? job.requiredLanguages.join(', ') : '-' },
            { label: 'Posting language', value: job.language ?? '-' },
          ]}
        />

        {job.summary ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Summary</p>
            <p className="max-w-[70ch] text-sm leading-relaxed text-foreground">{job.summary}</p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <SkillList label="Must-have skills" items={job.mustHaveSkills} tone="neutral" />
          <SkillList label="Nice to have" items={job.niceToHaveSkills} tone="muted" />
        </div>

        {job.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {job.tags.map((t) => (
              <ToneBadge key={t} tone="muted">
                {t}
              </ToneBadge>
            ))}
          </div>
        ) : null}

        <div className="border-t pt-4">
          <ContactEmailEditor key={job.contactEmail ?? ''} jobId={job.id} current={job.contactEmail} />
          {job.contactEmail && source ? (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Address source <ToneBadge tone={source.tone}>{source.label}</ToneBadge>
              {job.contactCandidates.length > 0 ? <span>· {job.contactCandidates.length} fallback address(es) if it bounces</span> : null}
            </p>
          ) : null}
        </div>
      </div>
    </Section>
  )
}
