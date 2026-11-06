'use client'

import { useCallback, useState } from 'react'
import { AlertTriangle, Loader2, Save, Undo2 } from 'lucide-react'
import { api, useApiMutation, useApiQuery, type ApiError } from '@/lib/api/hooks'
import type { AiConfig, EmailConfig, GeneralSettings, PortalConfig, RankingConfig, SearchConfig } from '@/lib/settings/schema'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** Shape returned by GET /api/settings (AppSettings with serialised dates). */
export interface SettingsPayload extends GeneralSettings {
  search: SearchConfig
  ranking: RankingConfig
  email: EmailConfig
  ai: AiConfig
  portal: PortalConfig
  updatedAt: string
}

export interface SectionMap {
  general: GeneralSettings
  search: SearchConfig
  ranking: RankingConfig
  email: EmailConfig
  ai: AiConfig
  portal: PortalConfig
}
export type SectionKey = keyof SectionMap

/** JSON with sorted object keys, so structurally-equal objects compare equal. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = obj[k]
          return acc
        }, {})
    }
    return v
  })
}

export function extractSection<K extends SectionKey>(settings: SettingsPayload, section: K): SectionMap[K] {
  if (section === 'general') {
    const general: GeneralSettings = {
      searchIntervalMinutes: settings.searchIntervalMinutes,
      searchEnabled: settings.searchEnabled,
      timezone: settings.timezone,
      digestEnabled: settings.digestEnabled,
      digestHourLocal: settings.digestHourLocal,
      digestEmail: settings.digestEmail ?? null,
      // Older API responses (app not restarted after the migration) have no push fields yet.
      pushEnabled: settings.pushEnabled ?? true,
      pushTypes: settings.pushTypes ?? ['interview', 'reply', 'review_needed', 'error'],
    }
    return general as SectionMap[K]
  }
  return settings[section as Exclude<SectionKey, 'general'>] as SectionMap[K]
}

interface EditableState<T> {
  key: string | null
  baseline: T | null
  draft: T | null
}

/**
 * Local editable copy of a remote object with dirty tracking.
 * Adopts new remote data whenever it changes, unless the user has unsaved edits.
 */
export function useEditable<T extends object>(remote: T | null) {
  const remoteKey = remote === null ? null : stableStringify(remote)
  const [state, setState] = useState<EditableState<T>>({ key: null, baseline: null, draft: null })

  if (remote !== null && remoteKey !== state.key) {
    const wasDirty = state.draft !== null && state.baseline !== null && stableStringify(state.draft) !== stableStringify(state.baseline)
    setState({ key: remoteKey, baseline: remote, draft: wasDirty ? state.draft : remote })
  }

  const value = state.draft ?? remote
  const baseline = state.baseline ?? remote
  const dirty = value !== null && baseline !== null && stableStringify(value) !== stableStringify(baseline)

  const set = useCallback((patch: Partial<T>) => {
    setState((s) => (s.draft === null ? s : { ...s, draft: { ...s.draft, ...patch } }))
  }, [])
  const replace = useCallback((next: T) => {
    setState((s) => ({ ...s, draft: next }))
  }, [])
  const discard = useCallback(() => {
    setState((s) => ({ ...s, draft: s.baseline }))
  }, [])
  /** Mark `next` as the new saved baseline (call after a successful save). */
  const commit = useCallback((next: T) => {
    setState({ key: stableStringify(next), baseline: next, draft: next })
  }, [])

  return { value, dirty, set, replace, discard, commit }
}

/**
 * Loads GET /api/settings, exposes an editable copy of one section and saves it via
 * PATCH /api/settings { [section]: value }.
 */
export function useSettingsSection<K extends SectionKey>(section: K) {
  const query = useApiQuery<SettingsPayload>(['settings'], '/api/settings')
  const settings = query.data?.data ?? null
  const remote = settings ? extractSection(settings, section) : null
  const editable = useEditable<SectionMap[K]>(remote)
  const { commit, discard: discardDraft, value } = editable

  const mutation = useApiMutation<SectionMap[K], SettingsPayload>((patch) => api.patch<SettingsPayload>('/api/settings', { [section]: patch }), {
    invalidate: [['settings'], ['status']],
    onSuccess: (data) => commit(extractSection(data, section)),
  })

  const { mutateAsync, isPending: saving, error: saveError, reset: resetSave } = mutation
  const save = useCallback(async () => {
    if (!value) return
    await mutateAsync(value)
  }, [mutateAsync, value])
  const discard = useCallback(() => {
    discardDraft()
    resetSave()
  }, [discardDraft, resetSave])

  return {
    ...editable,
    discard,
    settings,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    save,
    saving,
    saveError,
  }
}

interface ValidationIssue {
  path?: string
  message?: string
}

function issuesFrom(error: ApiError | null | undefined): ValidationIssue[] {
  if (!error || !Array.isArray(error.errors)) return []
  return error.errors.filter((e): e is ValidationIssue => typeof e === 'object' && e !== null)
}

export interface SaveBarProps {
  dirty: boolean
  saving?: boolean
  onSave: () => Promise<unknown> | unknown
  onDiscard: () => void
  error?: ApiError | null
  className?: string
}

/** Sticky bottom bar (above the mobile nav) that appears when there are unsaved changes. */
export function SaveBar({ dirty, saving = false, onSave, onDiscard, error, className }: SaveBarProps) {
  if (!dirty) return null
  const issues = issuesFrom(error)
  return (
    <div className={cn('sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 md:bottom-4', className)}>
      <div className="flex flex-col gap-2 rounded-lg border border-border-strong bg-popover/95 p-3 shadow-[var(--shadow-pop)] backdrop-blur supports-[backdrop-filter]:bg-popover/85">
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <AlertTriangle className="size-4 shrink-0 text-warning-text" />
            <span className="truncate">Unsaved changes</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={saving}>
              <Undo2 className="size-3.5" /> Discard
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => {
                void Promise.resolve(onSave()).catch(() => undefined)
              }}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {saving ? 'Saving' : 'Save'}
            </Button>
          </div>
        </div>
        {error ? (
          <div className="rounded-md bg-danger-soft px-2.5 py-2 text-xs text-danger-text">
            <p className="font-medium">{error.message}</p>
            {issues.length > 0 ? (
              <ul className="mt-1 list-disc pl-4">
                {issues.map((i, idx) => (
                  <li key={idx}>
                    {i.path ? <span className="font-mono">{i.path}</span> : null}
                    {i.path && i.message ? ': ' : ''}
                    {i.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function SettingsLoading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card" aria-busy="true" aria-label="Loading">
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-3 w-64 max-w-full" />
      </div>
      <div className="flex flex-col gap-4 p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingsError({ error, onRetry }: { error: { message: string } | null; onRetry: () => void }) {
  return (
    <div className="rounded-lg border bg-danger-soft p-4 text-sm">
      <p className="font-medium text-danger-text">Could not load settings</p>
      <p className="text-muted-foreground">{error?.message ?? 'Unknown error'}</p>
      <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
