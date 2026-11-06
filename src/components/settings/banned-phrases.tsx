'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Ban, Loader2, Plus, Search, Trash2 } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { cn } from '@/lib/utils'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { EmptyState } from '@/components/shared/page-header'
import { ToneBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { SectionCard } from './fields'

type Severity = 'error' | 'warn'

export interface BannedPhrase {
  id: string
  phrase: string
  severity: Severity
  category: string | null
  isRegex: boolean
  enabled: boolean
  createdAt: string
}

interface PhrasePatch {
  severity?: Severity
  enabled?: boolean
}

interface CreatePhraseBody {
  phrase: string
  severity: Severity
  category: string | null
  isRegex: boolean
}

const URL = '/api/settings/banned-phrases'
const INVALIDATE = [['banned-phrases']]
const SEVERITY_ITEMS: Array<{ value: Severity; label: string }> = [
  { value: 'error', label: 'Error (blocks sending)' },
  { value: 'warn', label: 'Warn (shown only)' },
]
const KNOWN_CATEGORIES = ['buzzword', 'cliche', 'opener', 'transition', 'ai_tell', 'punctuation']
const UNCATEGORISED = 'other'

function isSeverity(v: string): v is Severity {
  return v === 'error' || v === 'warn'
}

function PhraseRow({ row }: { row: BannedPhrase }) {
  const patch = useApiMutation<PhrasePatch, unknown>((body) => api.patch(`${URL}/${row.id}`, body), { invalidate: INVALIDATE, silent: true })
  const remove = useApiMutation<void, unknown>(() => api.delete(`${URL}/${row.id}`), { invalidate: INVALIDATE, successMessage: 'Phrase removed' })
  return (
    <div className={cn('flex items-center gap-2 px-3 py-1.5', !row.enabled && 'opacity-60')}>
      <span className={cn('min-w-0 flex-1 truncate text-sm', row.isRegex && 'font-mono text-xs')} title={row.phrase}>
        {row.isRegex ? <span className="mr-1 text-muted-foreground">/</span> : null}
        {row.phrase}
        {row.isRegex ? <span className="ml-1 text-muted-foreground">/i</span> : null}
      </span>
      <button
        type="button"
        className="shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        title="Click to toggle severity"
        aria-label={`Severity ${row.severity}, click to toggle`}
        disabled={patch.isPending}
        onClick={() => patch.mutate({ severity: row.severity === 'error' ? 'warn' : 'error' })}
      >
        <ToneBadge tone={row.severity === 'error' ? 'danger' : 'warning'} className="cursor-pointer">
          {row.severity}
        </ToneBadge>
      </button>
      <Switch size="sm" checked={row.enabled} onCheckedChange={(c) => patch.mutate({ enabled: c })} disabled={patch.isPending} aria-label={`Enable “${row.phrase}”`} />
      <ConfirmButton variant="ghost" size="icon-xs" aria-label={`Delete “${row.phrase}”`} title="Delete this phrase?" description={`“${row.phrase}” will no longer be checked.`} confirmLabel="Delete" onConfirm={() => remove.mutateAsync()}>
        <Trash2 className="size-3.5 text-muted-foreground" />
      </ConfirmButton>
    </div>
  )
}

function AddPhraseForm() {
  const [phrase, setPhrase] = useState('')
  const [severity, setSeverity] = useState<Severity>('error')
  const [category, setCategory] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [regexError, setRegexError] = useState<string | null>(null)

  const create = useApiMutation<CreatePhraseBody, BannedPhrase>((body) => api.post(URL, body), {
    invalidate: INVALIDATE,
    successMessage: 'Phrase added',
    onSuccess: () => {
      setPhrase('')
      setIsRegex(false)
      setRegexError(null)
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const p = phrase.trim()
    if (p.length < 2) return
    if (isRegex) {
      try {
        new RegExp(p)
      } catch (err) {
        setRegexError(err instanceof Error ? err.message : 'Invalid regular expression')
        return
      }
    }
    setRegexError(null)
    create.mutate({ phrase: isRegex ? p : p.toLowerCase(), severity, category: category.trim() || null, isRegex })
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-lg border bg-muted p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor="new-phrase">Phrase{isRegex ? ' (regular expression, case-insensitive)' : ''}</Label>
        <Input id="new-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={isRegex ? '(^|[.!?]\\s+)moreover,?\\s' : 'e.g. synergy'} className={cn(isRegex && 'font-mono text-xs')} required minLength={2} maxLength={200} spellCheck={false} />
        {regexError ? <p className="text-xs text-danger-text">{regexError}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="new-severity">Severity</Label>
          <Select
            value={severity}
            onValueChange={(val) => {
              const next = String(val ?? '')
              if (isSeverity(next)) setSeverity(next)
            }}
            items={SEVERITY_ITEMS.map((s) => ({ value: s.value, label: s.value }))}
          >
            <SelectTrigger id="new-severity" size="sm" className="w-full sm:w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_ITEMS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="new-category">Category</Label>
          <Input id="new-category" list="phrase-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="buzzword" className="h-7 text-[0.8rem] sm:w-32" maxLength={40} />
          <datalist id="phrase-categories">
            {KNOWN_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={isRegex} onCheckedChange={(c) => setIsRegex(c)} /> Regex
        </label>
        <Button type="submit" size="sm" disabled={create.isPending || phrase.trim().length < 2}>
          {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add
        </Button>
      </div>
    </form>
  )
}

export function BannedPhrasesCard() {
  const query = useApiQuery<BannedPhrase[]>(['banned-phrases'], URL)
  const [search, setSearch] = useState('')
  const rows = useMemo(() => query.data?.data ?? [], [query.data])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q ? rows.filter((r) => r.phrase.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q)) : rows
    const map = new Map<string, BannedPhrase[]>()
    for (const r of filtered) {
      const key = r.category?.trim() || UNCATEGORISED
      const list = map.get(key)
      if (list) list.push(r)
      else map.set(key, [r])
    }
    return [...map.entries()].sort(([a], [b]) => (a === UNCATEGORISED ? 1 : b === UNCATEGORISED ? -1 : a.localeCompare(b)))
  }, [rows, search])

  const enabledCount = rows.filter((r) => r.enabled).length

  return (
    <SectionCard title="Banned phrases" description={`Words and patterns the drafting linter rejects. “Error” blocks sending until rewritten; “warn” is only shown. ${enabledCount} of ${rows.length} active.`}>
      <AddPhraseForm />
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter phrases…" className="pl-8" aria-label="Filter phrases" />
      </div>
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : query.isError ? (
        <p className="text-sm text-danger-text">{query.error.message}</p>
      ) : groups.length === 0 ? (
        <EmptyState icon={<Ban className="size-6" />} title={search ? 'No phrases match' : 'No banned phrases'} description={search ? 'Try a different search.' : 'Add one above — the seed list can be restored by re-running the database seed.'} />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(([category, list]) => (
            <div key={category} className="overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <span className="capitalize">{category.replace(/_/g, ' ')}</span>
                <span className="tabular-nums">{list.length}</span>
              </div>
              <div className="divide-y">
                {list.map((row) => (
                  <PhraseRow key={row.id} row={row} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
