'use client'

import { useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { api, useApiMutation, useApiQuery, type ApiEnvelope } from '@/lib/api/hooks'
import { fmtDateTime } from '@/lib/format'
import { toDraft, toInput, type ProfileDraft } from '@/components/onboarding/draft'
import { AnswersSection, ExperienceSection, LookSection, VoiceSection, WantSection, WhereSection, WhoSection } from '@/components/onboarding/sections'
import { Hint } from './fields'
import { SaveBar, SettingsError, SettingsLoading, useEditable } from './settings-form'

/** The CandidateProfile row as JSON (GET /api/profile). Only the fields read here are typed. */
export type CandidateProfile = Record<string, unknown> & {
  id: number
  fullName: string
  parsedAt: string | null
  updatedAt: string
}

export interface ResumeInfo {
  id: string
  fileName: string
  sizeBytes: number
  createdAt: string
  parsedAt: string | null
}

export interface ProfilePayload {
  profile: CandidateProfile | null
  resume: ResumeInfo | null
  hasPhoto?: boolean
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4" aria-label={title}>
      <h2 className="pt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Settings > Profile: every answer from the onboarding form, on one page, built from the same
 * sections. One Save bar for all of it.
 */
export function ProfileForm() {
  const qc = useQueryClient()
  const query = useApiQuery<ProfilePayload>(['profile'], '/api/profile')
  const profile = query.data?.data.profile ?? null
  const remote = query.data ? toDraft(profile) : null
  const editable = useEditable<ProfileDraft>(remote)
  const { value, commit, discard: discardDraft } = editable

  const save = useApiMutation<Record<string, unknown>, CandidateProfile>((body) => api.patch<CandidateProfile>('/api/profile', body), {
    invalidate: [['onboarding']],
    onSuccess: (data) => {
      // Update the cached GET in place, so the form never shows the pre-save values while it refetches.
      qc.setQueryData<ApiEnvelope<ProfilePayload>>(['profile', '/api/profile'], (old) => (old ? { ...old, data: { ...old.data, profile: data } } : old))
      commit(toDraft(data))
    },
  })
  const { mutateAsync, reset } = save
  const onSave = useCallback(async () => {
    if (!value) return
    await mutateAsync(toInput(value))
  }, [mutateAsync, value])
  const onDiscard = useCallback(() => {
    discardDraft()
    reset()
  }, [discardDraft, reset])

  if (query.isPending) return <SettingsLoading />
  if (query.isError || !value) return <SettingsError error={query.error} onRetry={() => void query.refetch()} />

  const props = { d: value, set: editable.set }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {profile?.parsedAt ? `Last read from your CV ${fmtDateTime(profile.parsedAt)}. Your edits here win over the CV.` : 'Upload your CV above to fill this in, or type it in.'}
      </p>
      <Group title="Who you are">
        <WhoSection {...props} hasPhoto={query.data?.data.hasPhoto} />
      </Group>
      <Group title="Where you live and can work">
        <WhereSection {...props} />
      </Group>
      <Group title="What you want">
        <WantSection {...props} />
      </Group>
      <Group title="Languages">
        <LookSection {...props} showSearch={false} />
        <Hint>
          Countries to search, first-choice countries and remote options are in{' '}
          <Link href="/settings/search" className="text-primary-text underline-offset-4 hover:underline">
            Settings &gt; Search
          </Link>
          .
        </Hint>
      </Group>
      <Group title="Experience and education">
        <ExperienceSection {...props} />
      </Group>
      <Group title="Standard form answers">
        <AnswersSection {...props} />
      </Group>
      <Group title="Email voice">
        <VoiceSection {...props} />
      </Group>

      <SaveBar dirty={editable.dirty} saving={save.isPending} onSave={onSave} onDiscard={onDiscard} error={save.error} />
    </div>
  )
}
