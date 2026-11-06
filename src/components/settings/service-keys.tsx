'use client'

import { useState, type FormEvent } from 'react'
import { ExternalLink, Loader2, Plug, Save, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { EmptyState } from '@/components/shared/page-header'
import { ToneBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Field, Hint, SectionCard } from './fields'
import { KeyImportDialog } from './key-import'

/** GET /api/settings/service-keys: one entry per non-AI service the app can use. */
export interface ServiceInfo {
  service: string
  label: string
  fields: Array<{ name: string; label: string; secret: boolean }>
  configured: boolean
  source: 'db' | 'env' | null
  hint?: string
  docsUrl?: string
}

const SERVICES_URL = '/api/settings/service-keys'
const INVALIDATE = [['service-keys'], ['status']]

function ServiceCard({ s }: { s: ServiceInfo }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const filled = s.fields.every((f) => (values[f.name] ?? '').trim())
  const save = useApiMutation<Record<string, string>, unknown>((v) => api.put(`${SERVICES_URL}/${s.service}`, { values: v }), {
    invalidate: INVALIDATE,
    successMessage: `${s.label} saved`,
    onSuccess: () => setValues({}),
  })
  const remove = useApiMutation<void, unknown>(() => api.delete(`${SERVICES_URL}/${s.service}`), { invalidate: INVALIDATE, successMessage: `${s.label} removed` })
  const test = useApiMutation<void, { ok: boolean; error?: string }>(() => api.post(`${SERVICES_URL}/${s.service}/test`), {
    invalidate: INVALIDATE,
    silent: true,
    onSuccess: (r) => (r.ok ? toast.success(`${s.label} works`) : toast.error(`${s.label}: ${r.error ?? 'the test failed'}`)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!filled) return
    save.mutate(Object.fromEntries(s.fields.map((f) => [f.name, (values[f.name] ?? '').trim()])))
  }

  return (
    <SectionCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          {s.label}
          {s.source === 'db' ? (
            <ToneBadge tone="success" dot>
              saved
            </ToneBadge>
          ) : s.source === 'env' ? (
            <ToneBadge tone="info" dot>
              from .env
            </ToneBadge>
          ) : (
            <ToneBadge tone="muted">not set</ToneBadge>
          )}
        </span>
      }
      description={
        <>
          {s.hint}
          {s.docsUrl ? (
            <>
              {s.hint ? ' ' : ''}
              <a href={s.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary-text underline-offset-4 hover:underline">
                Get the details <ExternalLink className="size-3" aria-hidden />
              </a>
            </>
          ) : null}
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        {s.source === 'env' ? <Hint>Set in the server&apos;s .env file. Saving here takes precedence; removing it here falls back to .env again.</Hint> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {s.fields.map((f) => (
            <Field key={f.name} label={f.label} htmlFor={`svc-${s.service}-${f.name}`}>
              <Input
                id={`svc-${s.service}-${f.name}`}
                type={f.secret ? 'password' : 'text'}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                placeholder={s.configured ? (f.secret ? 'Saved (hidden). Type to replace' : 'Saved. Type to replace') : ''}
                autoComplete="off"
                spellCheck={false}
                maxLength={500}
              />
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={!filled || save.isPending}>
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!s.configured || test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
            Test
          </Button>
          {s.source === 'db' ? (
            <ConfirmButton
              size="sm"
              variant="ghost"
              title={`Remove the ${s.label} credentials?`}
              description="They are deleted from this install's database. A value in .env, if any, is used again."
              confirmLabel="Remove"
              onConfirm={() => remove.mutateAsync()}
            >
              <Trash2 className="size-3.5" /> Remove
            </ConfirmButton>
          ) : null}
        </div>
      </form>
    </SectionCard>
  )
}

/** Settings > Keys & services: credentials for job sources, notifications and mail, one card each. */
export function ServiceKeys() {
  const query = useApiQuery<ServiceInfo[]>(['service-keys'], SERVICES_URL)
  const list = query.data?.data ?? []
  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Keys and services"
        description="Job boards, phone notifications and mail need their own keys. Everything is optional: a service without a key is simply skipped. Values are stored encrypted."
        action={<KeyImportDialog />}
      >
        <p className="text-xs text-muted-foreground">Import keys reads a pasted list or a .env file and sorts AI keys and service keys for you.</p>
      </SectionCard>
      {query.isPending ? (
        <>
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </>
      ) : query.isError ? (
        <p className="text-sm text-danger-text">{query.error.message}</p>
      ) : list.length === 0 ? (
        <EmptyState icon={<Plug className="size-6" />} title="No services to set up" />
      ) : (
        list.map((s) => <ServiceCard key={s.service} s={s} />)
      )}
    </div>
  )
}
