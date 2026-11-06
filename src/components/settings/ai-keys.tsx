'use client'

import { useState, type FormEvent } from 'react'
import { ExternalLink, KeyRound, Loader2, Plus, Radar, Server, Settings2, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { fmtAgo, fmtIn, fmtNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { EmptyState, Stat } from '@/components/shared/page-header'
import { ToneBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { OptionSelect, SearchSelect } from '@/components/onboarding/pickers'
import { Field, NumberInput, SectionCard } from './fields'
import { KeyImportDialog, useProviders, type ProviderInfo } from './key-import'

export type { ProviderInfo }

// ---------------------------------------------------------------------------
// API shapes (GET /api/settings/ai-keys)
// ---------------------------------------------------------------------------

export interface KeyRow {
  id: string
  label: string
  provider: string
  providerLabel: string
  keyHint: string
  baseUrl: string | null
  enabled: boolean
  priority: number
  plan: string
  dailyCallCap: number | null
  primaryModel: string | null
  liteModel: string | null
  models: string[]
  /** ok | failed | unknown */
  status: string
  lastError: string | null
  lastTestedAt: string | null
  lastUsedAt: string | null
  usedToday: number
  cooldownUntil: string | null
}

interface KeyPatch {
  label?: string
  baseUrl?: string | null
  primaryModel?: string | null
  liteModel?: string | null
  plan?: 'free' | 'paid'
  dailyCallCap?: number | null
  priority?: number
  enabled?: boolean
}

interface TestResult {
  ok: boolean
  error?: string
  models?: string[]
}

export const KEYS_URL = '/api/settings/ai-keys'
export const KEY_INVALIDATE = [['ai-keys'], ['ai-usage'], ['status'], ['onboarding']]

const PLAN_ITEMS = [
  { value: 'free', label: 'Free tier' },
  { value: 'paid', label: 'Paid' },
]

const STATUS: Record<string, { tone: 'success' | 'danger' | 'muted'; label: string }> = {
  ok: { tone: 'success', label: 'Working' },
  failed: { tone: 'danger', label: 'Failed' },
  unknown: { tone: 'muted', label: 'Not tested' },
}

function StatusDot({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.unknown
  return (
    <ToneBadge tone={s.tone} dot>
      {s.label}
    </ToneBadge>
  )
}

// ---------------------------------------------------------------------------
// Add a key by hand
// ---------------------------------------------------------------------------

export function AddKeyDialog() {
  const providers = useProviders()
  const list = providers.data?.data ?? []
  const [open, setOpen] = useState(false)
  const [providerId, setProviderId] = useState('')
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [plan, setPlan] = useState<'free' | 'paid'>('free')
  const [cap, setCap] = useState(0)
  const provider = list.find((p) => p.id === providerId)

  const reset = () => {
    setProviderId('')
    setKey('')
    setLabel('')
    setBaseUrl('')
    setPlan('free')
    setCap(0)
  }

  const create = useApiMutation<Record<string, unknown>, KeyRow>((body) => api.post<KeyRow>(KEYS_URL, body), {
    invalidate: KEY_INVALIDATE,
    silent: true,
    onSuccess: (row) => {
      toast.success(`Key added: ${row.label}`)
      setOpen(false)
      reset()
    },
  })

  const keyOk = provider?.keyOptional ? true : key.trim().length >= 8
  const urlOk = provider?.needsBaseUrl ? /^https?:\/\/\S+$/.test(baseUrl.trim()) : true
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!provider) return
    create.mutate({
      provider: provider.id,
      key: key.trim(),
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      plan,
      ...(plan === 'paid' && cap > 0 ? { dailyCallCap: cap } : {}),
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) create.reset()
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-3.5" /> Add key
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add an AI key</DialogTitle>
            <DialogDescription>Keys are stored encrypted in this install&apos;s database. Test the key after adding it to list its models.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Provider" htmlFor="add-key-provider">
              {providers.isPending ? (
                <Skeleton className="h-8 w-full" />
              ) : providers.isError ? (
                <p className="text-sm text-danger-text">{providers.error.message}</p>
              ) : (
                <SearchSelect
                  id="add-key-provider"
                  value={providerId}
                  onChange={setProviderId}
                  options={list.map((p) => ({ value: p.id, label: p.label, keywords: [p.adapter] }))}
                  placeholder="Choose a provider"
                  searchPlaceholder="Search providers"
                  emptyText="No provider with that name"
                />
              )}
            </Field>
            {provider?.keysUrl ? (
              <a href={provider.keysUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-xs text-primary-text underline-offset-4 hover:underline">
                Where to get a {provider.label} key <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
            <Field label={provider?.keyOptional ? 'API key (optional for this provider)' : 'API key'} htmlFor="add-key-value">
              <Input
                id="add-key-value"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={provider?.keyPlaceholder || 'Paste the key'}
                autoComplete="off"
                spellCheck={false}
                maxLength={400}
                disabled={!provider}
              />
            </Field>
            {provider?.needsBaseUrl ? (
              <Field label="Base URL" htmlFor="add-key-url" help="The OpenAI-compatible endpoint, e.g. http://localhost:11434/v1 for Ollama.">
                <Input id="add-key-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" spellCheck={false} />
              </Field>
            ) : null}
            <Field label="Label (optional)" htmlFor="add-key-label" help="Helps you tell keys apart, e.g. personal or work.">
              <Input id="add-key-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Plan" htmlFor="add-key-plan" help="Paid keys are limited by your daily cap, not the free quota.">
                <OptionSelect id="add-key-plan" value={plan} onChange={(v) => setPlan(v === 'paid' ? 'paid' : 'free')} options={PLAN_ITEMS} />
              </Field>
              {plan === 'paid' ? (
                <Field label="Daily call cap" htmlFor="add-key-cap" help="0 = no cap. A spending guard.">
                  <NumberInput id="add-key-cap" integer min={0} max={1_000_000} value={cap} onValueChange={(n) => setCap(Math.max(0, n))} />
                </Field>
              ) : null}
            </div>
            {create.error ? (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-text">
                {create.error.status === 409 ? 'This key is already saved.' : create.error.message}
              </p>
            ) : null}
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={!provider || !keyOk || !urlOk || create.isPending}>
              {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
              Add key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// One key
// ---------------------------------------------------------------------------

function ModelPicker({ id, label, help, value, models, fallback, onChange }: { id: string; label: string; help: string; value: string; models: string[]; fallback: string | null; onChange: (v: string) => void }) {
  return (
    <Field label={label} htmlFor={id} help={help}>
      {models.length ? (
        <OptionSelect
          id={id}
          value={value}
          onChange={onChange}
          emptyLabel={fallback ? `Provider default (${fallback})` : 'Provider default'}
          options={[...(value && !models.includes(value) ? [value] : []), ...models].map((m) => ({ value: m, label: m }))}
          className="font-mono text-xs"
        />
      ) : (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={fallback ?? 'Run Discover models first'} className="font-mono text-xs" spellCheck={false} />
      )}
    </Field>
  )
}

function KeyEditor({ row, provider, onDone }: { row: KeyRow; provider?: ProviderInfo; onDone: () => void }) {
  const [label, setLabel] = useState(row.label)
  const [priority, setPriority] = useState(row.priority)
  const [plan, setPlan] = useState<'free' | 'paid'>(row.plan === 'paid' ? 'paid' : 'free')
  const [cap, setCap] = useState(row.dailyCallCap ?? 0)
  const [primary, setPrimary] = useState(row.primaryModel ?? '')
  const [lite, setLite] = useState(row.liteModel ?? '')
  const [baseUrl, setBaseUrl] = useState(row.baseUrl ?? '')
  const save = useApiMutation<KeyPatch, KeyRow>((body) => api.patch<KeyRow>(`${KEYS_URL}/${row.id}`, body), { invalidate: KEY_INVALIDATE, successMessage: 'Key saved', onSuccess: onDone })
  const showUrl = Boolean(provider?.needsBaseUrl || row.baseUrl)
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({
          label: label.trim() || row.label,
          priority,
          plan,
          dailyCallCap: plan === 'paid' && cap > 0 ? cap : null,
          primaryModel: primary.trim() || null,
          liteModel: lite.trim() || null,
          ...(showUrl ? { baseUrl: baseUrl.trim() || null } : {}),
        })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Label" htmlFor={`k-label-${row.id}`}>
          <Input id={`k-label-${row.id}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Priority" htmlFor={`k-priority-${row.id}`} help="Lower numbers are used first.">
          <NumberInput id={`k-priority-${row.id}`} integer min={0} max={1000} value={priority} onValueChange={(n) => setPriority(Math.max(0, n))} />
        </Field>
        <Field label="Plan" htmlFor={`k-plan-${row.id}`}>
          <OptionSelect id={`k-plan-${row.id}`} value={plan} onChange={(v) => setPlan(v === 'paid' ? 'paid' : 'free')} options={PLAN_ITEMS} />
        </Field>
        {plan === 'paid' ? (
          <Field label="Daily call cap" htmlFor={`k-cap-${row.id}`} help="0 = no cap.">
            <NumberInput id={`k-cap-${row.id}`} integer min={0} max={1_000_000} value={cap} onValueChange={(n) => setCap(Math.max(0, n))} />
          </Field>
        ) : null}
        <ModelPicker id={`k-primary-${row.id}`} label="Primary model" help="Writing and careful checks." value={primary} models={row.models} fallback={provider?.defaultPrimary ?? null} onChange={setPrimary} />
        <ModelPicker id={`k-lite-${row.id}`} label="Lite model" help="Fast, cheap bulk work like ranking." value={lite} models={row.models} fallback={provider?.defaultLite ?? null} onChange={setLite} />
        {showUrl ? (
          <Field label="Base URL" htmlFor={`k-url-${row.id}`} className="sm:col-span-2">
            <Input id={`k-url-${row.id}`} type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
          </Field>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </form>
  )
}

function KeyRowView({ row, provider }: { row: KeyRow; provider?: ProviderInfo }) {
  const [editing, setEditing] = useState(false)
  const toggle = useApiMutation<boolean, KeyRow>((enabled) => api.patch<KeyRow>(`${KEYS_URL}/${row.id}`, { enabled }), { invalidate: KEY_INVALIDATE, silent: true })
  const remove = useApiMutation<void, unknown>(() => api.delete(`${KEYS_URL}/${row.id}`), { invalidate: KEY_INVALIDATE, successMessage: 'Key removed' })
  const test = useApiMutation<'test' | 'discover', TestResult>(() => api.post<TestResult>(`${KEYS_URL}/${row.id}/test`), { invalidate: KEY_INVALIDATE, silent: true })
  const runTest = (mode: 'test' | 'discover') =>
    test.mutate(mode, {
      onSuccess: (env) => {
        const r = env.data
        if (!r.ok) toast.error(`${row.label}: ${r.error ?? 'the test failed'}`)
        else if (mode === 'discover') toast.success(`${row.label}: ${r.models?.length ?? 0} models found`)
        else toast.success(`${row.label} works`)
      },
      onError: (err) => toast.error(err.message),
    })
  const busy = test.isPending
  const cooling = Boolean(row.cooldownUntil && new Date(row.cooldownUntil) > new Date())
  const models = [row.primaryModel ?? provider?.defaultPrimary, row.liteModel ?? provider?.defaultLite].filter(Boolean)

  return (
    <div className={cn('flex flex-col gap-2 p-3', !row.enabled && 'opacity-70')}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <span className="truncate">{row.label}</span>
            <code className="rounded bg-muted px-1 font-mono text-[11px] text-muted-foreground">...{row.keyHint}</code>
            <StatusDot status={row.status} />
            {row.plan === 'paid' ? <ToneBadge tone="info">paid{row.dailyCallCap ? ` · cap ${fmtNumber(row.dailyCallCap)}/day` : ''}</ToneBadge> : <ToneBadge tone="neutral">free</ToneBadge>}
            {cooling ? <ToneBadge tone="warning">resting · back {fmtIn(row.cooldownUntil)}</ToneBadge> : null}
            {!row.enabled ? <ToneBadge tone="muted">off</ToneBadge> : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Priority {row.priority} · {fmtNumber(row.usedToday)} calls today
            {row.lastUsedAt ? ` · last used ${fmtAgo(row.lastUsedAt)}` : ' · never used'}
            {row.lastTestedAt ? ` · tested ${fmtAgo(row.lastTestedAt)}` : ''}
          </p>
          {models.length ? <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{models.join(' / ')}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Switch checked={row.enabled} onCheckedChange={(c) => toggle.mutate(c)} disabled={toggle.isPending} aria-label={`Use ${row.label}`} />
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => runTest('test')}>
            {busy && test.variables === 'test' ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
            Test
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => runTest('discover')}>
            {busy && test.variables === 'discover' ? <Loader2 className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />}
            Discover models
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Edit ${row.label}`} aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
            <Settings2 className="size-4 text-muted-foreground" />
          </Button>
          <ConfirmButton
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${row.label}`}
            title="Delete this key?"
            description={`"${row.label}" is removed from this install. Its usage history is kept.`}
            confirmLabel="Delete"
            onConfirm={() => remove.mutateAsync()}
          >
            <Trash2 className="size-4 text-muted-foreground" />
          </ConfirmButton>
        </div>
      </div>
      {row.lastError && row.status === 'failed' ? <p className="line-clamp-2 text-xs wrap-break-word text-danger-text">{row.lastError}</p> : null}
      {editing ? <KeyEditor row={row} provider={provider} onDone={() => setEditing(false)} /> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function ImportEnvButton() {
  const run = useApiMutation<void, { added: number; skipped: number }>(() => api.post(`${KEYS_URL}/import-env`), {
    invalidate: [...KEY_INVALIDATE, ['service-keys']],
    successMessage: (r) => (r.added ? `Imported ${r.added} key${r.added === 1 ? '' : 's'} from .env${r.skipped ? ` (${r.skipped} already saved)` : ''}` : r.skipped ? 'Every key in .env is already saved' : 'No AI keys found in .env'),
  })
  return (
    <Button type="button" size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
      {run.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Server className="size-3.5" />}
      Import from this server&apos;s .env
    </Button>
  )
}

/** Keys grouped by provider; groups follow the best (lowest) priority inside them. */
function groupByProvider(rows: KeyRow[]): Array<{ provider: string; label: string; rows: KeyRow[] }> {
  const map = new Map<string, { provider: string; label: string; rows: KeyRow[] }>()
  for (const r of [...rows].sort((a, b) => a.priority - b.priority)) {
    const g = map.get(r.provider) ?? { provider: r.provider, label: r.providerLabel || r.provider, rows: [] }
    g.rows.push(r)
    map.set(r.provider, g)
  }
  return [...map.values()]
}

/** The AI key list with Add, Import and Import-from-.env; used in Settings > AI and onboarding step 1. */
export function AiKeysCard({ title = 'AI keys', intro }: { title?: string; intro?: string }) {
  const query = useApiQuery<KeyRow[]>(['ai-keys'], KEYS_URL)
  const providers = useProviders()
  const byId = new Map((providers.data?.data ?? []).map((p) => [p.id, p]))
  const rows = query.data?.data ?? []
  const groups = groupByProvider(rows)

  return (
    <SectionCard
      title={title}
      description={intro ?? 'Calls go to enabled keys in priority order. When a key hits its limit or fails, the next one takes over. Each key has its own models.'}
      action={
        <>
          <KeyImportDialog />
          <AddKeyDialog />
        </>
      }
    >
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : query.isError ? (
        <p className="text-sm text-danger-text">{query.error.message}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={<KeyRound className="size-6" />}
          title="No AI keys yet"
          description="Without a key the app still finds jobs, but it cannot read your CV, rank jobs with AI or write applications."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.provider} className="overflow-hidden rounded-lg border">
              <p className="border-b bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                {g.label} · {g.rows.length} key{g.rows.length === 1 ? '' : 's'}
              </p>
              <div className="divide-y">
                {g.rows.map((row) => (
                  <KeyRowView key={row.id} row={row} provider={byId.get(row.provider)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <ImportEnvButton />
        <p className="text-xs text-muted-foreground">Copies the AI keys set in the server&apos;s .env file into this list. It never happens on its own.</p>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Usage today
// ---------------------------------------------------------------------------

interface UsageSummary {
  date: string
  totalCalls: number
  totalErrors: number
  inputTokens: number
  outputTokens: number
  byTask: Array<{ task: string; calls: number; inputTokens: number; outputTokens: number }>
  primaryRemaining?: number
  liteRemaining?: number
}

export function AiUsageCard() {
  const query = useApiQuery<UsageSummary>(['ai-usage'], '/api/settings/ai-test', { refetchInterval: 30_000 })
  const u = query.data?.data

  return (
    <SectionCard title="Usage today" description={u ? `AI calls since the start of today's quota day (${u.date}).` : undefined}>
      {query.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : query.isError || !u ? (
        <p className="text-sm text-danger-text">{query.error?.message ?? 'Could not load usage'}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Calls" value={fmtNumber(u.totalCalls)} />
            <Stat label="Errors" value={<span className={cn(u.totalErrors > 0 && 'text-danger-text')}>{fmtNumber(u.totalErrors)}</span>} />
            <Stat label="Tokens" value={fmtNumber(u.inputTokens + u.outputTokens)} hint={`${fmtNumber(u.inputTokens)} in · ${fmtNumber(u.outputTokens)} out`} />
            <Stat
              label="Left today"
              value={typeof u.primaryRemaining === 'number' ? fmtNumber(u.primaryRemaining) : '-'}
              hint={typeof u.liteRemaining === 'number' ? `primary · ${fmtNumber(u.liteRemaining)} lite` : undefined}
            />
          </div>
          {u.byTask.length > 0 ? (
            <div className="overflow-hidden rounded-lg border text-sm">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <span>Task</span>
                <span className="text-right">Calls</span>
                <span className="text-right">Tokens</span>
              </div>
              {u.byTask.map((t) => (
                <div key={t.task} className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-t px-3 py-1.5">
                  <span className="truncate font-mono text-xs leading-5">{t.task}</span>
                  <span className="text-right tabular-nums">{fmtNumber(t.calls)}</span>
                  <span className="text-right tabular-nums text-muted-foreground">{fmtNumber(t.inputTokens + t.outputTokens)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No AI calls yet today.</p>
          )}
        </>
      )}
    </SectionCard>
  )
}
