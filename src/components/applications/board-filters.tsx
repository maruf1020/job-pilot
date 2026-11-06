'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Filter, Search, X } from 'lucide-react'
import { APPLICATION_STATUSES, APPLY_CHANNELS, countryName, EU_COUNTRY_CODES, SPONSORSHIP_LEVELS } from '@/lib/domain'
import { APP_STATUS_LABEL, flagEmoji, SPONSORSHIP_LABEL } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { channelLabel } from './helpers'

/** Everything the board can be narrowed by. Lives in the URL so a filtered board can be reloaded or shared. */
export interface BoardFilters {
  q: string
  channel: string
  country: string
  company: string
  scoreMin: string
  scoreMax: string
  sponsorship: string
  sentFrom: string
  sentTo: string
  activityFrom: string
  activityTo: string
  replied: '' | 'yes' | 'no'
  followUp: '' | 'yes' | 'no'
  to: string
  statuses: string[]
  sort: 'activity' | 'score' | 'sent'
  hideEmpty: boolean
}

export const EMPTY_FILTERS: BoardFilters = {
  q: '',
  channel: '',
  country: '',
  company: '',
  scoreMin: '',
  scoreMax: '',
  sponsorship: '',
  sentFrom: '',
  sentTo: '',
  activityFrom: '',
  activityTo: '',
  replied: '',
  followUp: '',
  to: '',
  statuses: [],
  sort: 'activity',
  hideEmpty: false,
}

const PARAM_KEYS: Array<keyof BoardFilters> = ['q', 'channel', 'country', 'company', 'scoreMin', 'scoreMax', 'sponsorship', 'sentFrom', 'sentTo', 'activityFrom', 'activityTo', 'replied', 'followUp', 'to', 'sort']

export function filtersFromParams(sp: URLSearchParams): BoardFilters {
  const f: BoardFilters = { ...EMPTY_FILTERS }
  for (const k of PARAM_KEYS) {
    const v = sp.get(`b.${k}`)
    if (v) (f as unknown as Record<string, string>)[k] = v
  }
  if (!['activity', 'score', 'sent'].includes(f.sort)) f.sort = 'activity'
  if (!['', 'yes', 'no'].includes(f.replied)) f.replied = ''
  if (!['', 'yes', 'no'].includes(f.followUp)) f.followUp = ''
  f.statuses = (sp.get('b.statuses') ?? '').split(',').filter((s) => (APPLICATION_STATUSES as readonly string[]).includes(s))
  f.hideEmpty = sp.get('b.hideEmpty') === '1'
  return f
}

export function filtersToParams(f: BoardFilters, base: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base.toString())
  for (const k of [...PARAM_KEYS, 'statuses', 'hideEmpty']) params.delete(`b.${k}`)
  for (const k of PARAM_KEYS) {
    const v = f[k] as string
    if (v && !(k === 'sort' && v === 'activity')) params.set(`b.${k}`, v)
  }
  if (f.statuses.length) params.set('b.statuses', f.statuses.join(','))
  if (f.hideEmpty) params.set('b.hideEmpty', '1')
  return params
}

/** How many filters are active (excluding search and sort, which are visible in the toolbar). */
export function activeFilterCount(f: BoardFilters): number {
  let n = 0
  for (const k of PARAM_KEYS) if (k !== 'q' && k !== 'sort' && f[k]) n++
  if (f.statuses.length) n++
  if (f.hideEmpty) n++
  return n
}

/** Translate the board filters into the applications list API query string (without status). */
export function filtersToApiParams(f: BoardFilters): URLSearchParams {
  const sp = new URLSearchParams()
  if (f.q.trim()) sp.set('q', f.q.trim())
  if (f.channel) sp.set('filter[channel]', f.channel)
  if (f.country) sp.set('filter[country]', f.country)
  if (f.company.trim()) sp.set('filter[company][contains]', f.company.trim())
  if (f.scoreMin) sp.set('filter[score][gte]', f.scoreMin)
  if (f.scoreMax) sp.set('filter[score][lte]', f.scoreMax)
  if (f.sponsorship) sp.set('filter[sponsorship]', f.sponsorship)
  if (f.sentFrom) sp.set('filter[sent][gte]', f.sentFrom)
  if (f.sentTo) sp.set('filter[sent][lte]', `${f.sentTo}T23:59:59`)
  if (f.activityFrom) sp.set('filter[activity][gte]', f.activityFrom)
  if (f.activityTo) sp.set('filter[activity][lte]', `${f.activityTo}T23:59:59`)
  if (f.replied) sp.set('filter[replied][isnull]', f.replied === 'yes' ? 'false' : 'true')
  if (f.followUp) sp.set('filter[followUp][isnull]', f.followUp === 'yes' ? 'false' : 'true')
  if (f.to.trim()) sp.set('filter[toEmail][contains]', f.to.trim())
  sp.set('sort', f.sort === 'score' ? '-score' : f.sort === 'sent' ? '-sentAt' : '-lastActivityAt')
  return sp
}

/** URL-backed filter state for the board. */
export function useBoardFilters(): [BoardFilters, (next: BoardFilters) => void] {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(sp.toString())), [sp])
  const setFilters = useCallback(
    (next: BoardFilters) => {
      const params = filtersToParams(next, new URLSearchParams(sp.toString()))
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, sp],
  )
  return [filters, setFilters]
}

const ANY = '__any__'

function AnySelect({ id, value, onChange, options, anyLabel = 'Any' }: { id: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; anyLabel?: string }) {
  const items = [{ value: ANY, label: anyLabel }, ...options]
  return (
    <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY || v == null ? '' : String(v))} items={items}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Search box (debounced into the URL) + sort + the filter side panel. */
export function BoardToolbar({ filters, onChange, className }: { filters: BoardFilters; onChange: (next: BoardFilters) => void; className?: string }) {
  const [q, setQ] = useState(filters.q)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<BoardFilters>(filters)
  const active = activeFilterCount(filters)

  // Debounce typing into the URL; keep the box in sync when the URL changes elsewhere (Clear, back button).
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== filters.q) onChange({ ...filters, q })
    }, 300)
    return () => clearTimeout(t)
  }, [q, filters, onChange])
  const urlQ = filters.q
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ)
  if (urlQ !== seenUrlQ) {
    setSeenUrlQ(urlQ)
    setQ(urlQ)
  }

  const openPanel = (v: boolean) => {
    if (v) setDraft(filters)
    setOpen(v)
  }
  const apply = () => {
    onChange({ ...draft, q })
    setOpen(false)
  }
  const clearAll = () => {
    setQ('')
    onChange({ ...EMPTY_FILTERS })
    setOpen(false)
  }
  const d = (patch: Partial<BoardFilters>) => setDraft((prev) => ({ ...prev, ...patch }))

  const countryOptions = EU_COUNTRY_CODES.map((c) => ({ value: c, label: `${flagEmoji(c)} ${countryName(c)}` }))

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="relative min-w-56 flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job title or company…" className="pl-8" aria-label="Search applications" />
        {q ? (
          <button type="button" onClick={() => setQ('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear search">
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      <Select value={filters.sort} onValueChange={(v) => onChange({ ...filters, sort: (v as BoardFilters['sort']) ?? 'activity' })} items={[{ value: 'activity', label: 'Latest activity' }, { value: 'score', label: 'Highest score' }, { value: 'sent', label: 'Recently sent' }]}>
        <SelectTrigger size="sm" className="w-40" aria-label="Sort cards">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="activity">Latest activity</SelectItem>
          <SelectItem value="score">Highest score</SelectItem>
          <SelectItem value="sent">Recently sent</SelectItem>
        </SelectContent>
      </Select>

      <Sheet open={open} onOpenChange={openPanel}>
        <SheetTrigger render={<Button variant={active ? 'default' : 'outline'} size="sm" />}>
          <Filter className="size-3.5" /> Filters
          {active ? <Badge variant="secondary" className="ml-1 h-5 min-w-5 justify-center px-1">{active}</Badge> : null}
        </SheetTrigger>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle>Filter the board</SheetTitle>
            <SheetDescription>Every column is narrowed by the same filters. They stay in the page address, so a filtered board can be bookmarked.</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-5 px-5 py-4">
            <fieldset className="grid gap-3">
              <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Job</legend>
              <div className="grid gap-1.5">
                <Label htmlFor="bf-company">Company contains</Label>
                <Input id="bf-company" value={draft.company} onChange={(e) => d({ company: e.target.value })} placeholder="e.g. Stripe" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bf-country">Country</Label>
                <AnySelect id="bf-country" value={draft.country} onChange={(country) => d({ country })} options={countryOptions} anyLabel="Any country" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="bf-score-min">Score from</Label>
                  <Input id="bf-score-min" type="number" min={0} max={100} value={draft.scoreMin} onChange={(e) => d({ scoreMin: e.target.value })} placeholder="0" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="bf-score-max">Score to</Label>
                  <Input id="bf-score-max" type="number" min={0} max={100} value={draft.scoreMax} onChange={(e) => d({ scoreMax: e.target.value })} placeholder="100" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bf-sponsorship">Visa sponsorship</Label>
                <AnySelect id="bf-sponsorship" value={draft.sponsorship} onChange={(sponsorship) => d({ sponsorship })} options={SPONSORSHIP_LEVELS.map((s) => ({ value: s, label: SPONSORSHIP_LABEL[s].label }))} />
              </div>
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Application</legend>
              <div className="grid gap-1.5">
                <Label htmlFor="bf-channel">Channel</Label>
                <AnySelect id="bf-channel" value={draft.channel} onChange={(channel) => d({ channel })} options={APPLY_CHANNELS.map((c) => ({ value: c, label: channelLabel(c) }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bf-to">Recipient contains</Label>
                <Input id="bf-to" value={draft.to} onChange={(e) => d({ to: e.target.value })} placeholder="e.g. careers@" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="bf-replied">Got a reply</Label>
                  <AnySelect id="bf-replied" value={draft.replied} onChange={(v) => d({ replied: v as BoardFilters['replied'] })} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="bf-followup">Follow-up sent</Label>
                  <AnySelect id="bf-followup" value={draft.followUp} onChange={(v) => d({ followUp: v as BoardFilters['followUp'] })} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
                </div>
              </div>
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Dates</legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="bf-sent-from">Sent from</Label>
                  <Input id="bf-sent-from" type="date" value={draft.sentFrom} onChange={(e) => d({ sentFrom: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="bf-sent-to">Sent to</Label>
                  <Input id="bf-sent-to" type="date" value={draft.sentTo} onChange={(e) => d({ sentTo: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="bf-act-from">Activity from</Label>
                  <Input id="bf-act-from" type="date" value={draft.activityFrom} onChange={(e) => d({ activityFrom: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="bf-act-to">Activity to</Label>
                  <Input id="bf-act-to" type="date" value={draft.activityTo} onChange={(e) => d({ activityTo: e.target.value })} />
                </div>
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Statuses on the board</legend>
              <p className="text-xs text-muted-foreground">Untick a status to hide those cards. Nothing ticked means all statuses.</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {APPLICATION_STATUSES.map((s) => {
                  const checked = draft.statuses.length === 0 || draft.statuses.includes(s)
                  return (
                    <label key={s} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) => {
                          const current = draft.statuses.length === 0 ? [...APPLICATION_STATUSES] : draft.statuses
                          const next = c ? [...new Set([...current, s])] : current.filter((x) => x !== s)
                          d({ statuses: next.length === APPLICATION_STATUSES.length ? [] : next })
                        }}
                      />
                      {APP_STATUS_LABEL[s].label}
                    </label>
                  )
                })}
              </div>
              <label className="mt-1 flex items-center gap-2 text-sm">
                <Checkbox checked={draft.hideEmpty} onCheckedChange={(c) => d({ hideEmpty: Boolean(c) })} /> Hide empty columns
              </label>
            </fieldset>
          </div>

          <SheetFooter className="mt-auto flex-row justify-between gap-2 border-t px-5 py-3">
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear all
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={apply}>
                Apply
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {active ? (
        <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground">
          <X className="size-3.5" /> Clear
        </Button>
      ) : null}
    </div>
  )
}
