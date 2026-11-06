'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { useDebouncedValue } from '@/hooks/use-debounce'
import { useTableQuery } from '@/hooks/use-table-query'
import { useApiQuery } from '@/lib/api/hooks'
import type { PaginationMeta } from '@/lib/table-query/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FilterChip } from '@/components/shared/filter-bar'
import { EmptyState } from '@/components/shared/page-header'

export interface DataTableColumn<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** API sort field; omit for unsortable columns. */
  sortKey?: string
  className?: string
  headerClassName?: string
  /** Hide the column below this breakpoint (table mode only). */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
  align?: 'left' | 'right' | 'center'
}

export interface DataTableFilter {
  /** Filter key as the API expects it (e.g. "status" or "score[gte]"). */
  key: string
  label: string
  type: 'select' | 'text' | 'boolean' | 'date' | 'number'
  options?: Array<{ value: string; label: string }>
  placeholder?: string
}

export interface BulkAction {
  label: string
  icon?: ReactNode
  variant?: 'default' | 'outline' | 'destructive' | 'secondary'
  onAction: (ids: string[]) => Promise<unknown> | unknown
}

export interface DataTableProps<T> {
  endpoint: string
  queryKey: string
  columns: DataTableColumn<T>[]
  renderMobileCard: (row: T) => ReactNode
  filters?: DataTableFilter[]
  searchPlaceholder?: string
  defaultSort?: string
  defaultPageSize?: number
  rowHref?: (row: T) => string
  rowKey?: (row: T) => string
  bulkActions?: BulkAction[]
  toolbarExtra?: ReactNode
  emptyTitle?: ReactNode
  emptyDescription?: ReactNode
  refetchInterval?: number
  /** Extra query params always sent to the API (e.g. a fixed filter). */
  extraParams?: Record<string, string>
  className?: string
}

const HIDE_CLASS: Record<NonNullable<DataTableColumn<unknown>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
}

const ANY = '__any'
const PAGE_SIZES = ['10', '20', '50', '100']

export function DataTable<T extends { id: string }>(props: DataTableProps<T>) {
  const { columns, filters = [], bulkActions = [], rowHref } = props
  const router = useRouter()
  const { state, update, apiQuery } = useTableQuery({ pageSize: props.defaultPageSize ?? 20, sort: props.defaultSort ?? null })
  const [search, setSearch] = useState(state.q)
  const [syncedQ, setSyncedQ] = useState(state.q)
  const debounced = useDebouncedValue(search, 300)
  // Selection is scoped to the current query URL: a new page/filter/sort clears it.
  const [selection, setSelection] = useState<{ url: string; ids: Set<string> }>({ url: '', ids: new Set() })
  const [busy, setBusy] = useState(false)

  // Keep the input in step when the URL changes from outside (back button, links).
  if (syncedQ !== state.q) {
    setSyncedQ(state.q)
    setSearch(state.q)
  }

  useEffect(() => {
    if (debounced !== state.q) update({ q: debounced }, { resetPage: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const url = useMemo(() => {
    const extra = new URLSearchParams(props.extraParams ?? {}).toString()
    return `${props.endpoint}?${apiQuery}${extra ? `&${extra}` : ''}`
  }, [props.endpoint, apiQuery, props.extraParams])

  const query = useApiQuery<T[]>([props.queryKey, 'list'], url, { placeholderData: keepPreviousData, refetchInterval: props.refetchInterval })
  const rows = query.data?.data ?? []
  const meta = query.data?.meta as PaginationMeta | undefined
  const rowKey = props.rowKey ?? ((r: T) => r.id)

  const selected = selection.url === url ? selection.ids : new Set<string>()
  const setSelected = (ids: Set<string>) => setSelection({ url, ids })

  const toggleSort = (sortKey: string) => {
    const cur = state.sort
    const next = cur === sortKey ? `-${sortKey}` : cur === `-${sortKey}` ? null : sortKey
    update({ sort: next }, { resetPage: true })
  }
  const setFilter = (key: string, value: string) => {
    const filters = { ...state.filters }
    if (!value || value === ANY) delete filters[key]
    else filters[key] = value
    update({ filters }, { resetPage: true })
  }
  const activeFilterCount = Object.keys(state.filters).length
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(rowKey(r)))

  const runBulk = async (action: BulkAction) => {
    setBusy(true)
    try {
      await action.onAction([...selected])
      setSelected(new Set())
      await query.refetch()
    } finally {
      setBusy(false)
    }
  }

  const clearAll = () => update({ filters: {} }, { resetPage: true })
  const filterControls = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {filters.map((f) => (
        <div key={f.key} className="flex min-w-0 flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
          <FilterControl filter={f} value={state.filters[f.key] ?? ''} onChange={(v) => setFilter(f.key, v)} />
        </div>
      ))}
    </div>
  )
  const filterButton = (
    <Button variant="outline" className={cn('gap-1.5', activeFilterCount && 'border-primary/50 text-foreground')}>
      <SlidersHorizontal className="size-4" /> Filters
      {activeFilterCount ? <span className="rounded-md bg-primary-soft px-1.5 text-[11px] font-semibold leading-4 text-primary-text tabular-nums">{activeFilterCount}</span> : null}
    </Button>
  )
  // Active filters as chips, so what narrows the list is always visible and one click removes it.
  const chips = filters
    .filter((f) => state.filters[f.key])
    .map((f) => ({ key: f.key, label: f.label, value: filterValueLabel(f, state.filters[f.key]) }))

  return (
    <div className={cn('flex flex-col gap-3', props.className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={props.searchPlaceholder ?? 'Search…'} className="pl-8" aria-label="Search" />
        </div>
        {filters.length > 0 ? (
          <>
            <Popover>
              <PopoverTrigger className="hidden md:inline-flex" render={filterButton} />
              <PopoverContent align="start" className="w-[min(92vw,34rem)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium">Filters</p>
                  {activeFilterCount ? (
                    <Button variant="ghost" size="xs" onClick={clearAll}>
                      Clear all
                    </Button>
                  ) : null}
                </div>
                {filterControls}
              </PopoverContent>
            </Popover>
            <Sheet>
              <SheetTrigger className="md:hidden" render={filterButton} />
              <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-4">
                <SheetHeader className="flex-row items-center justify-between p-0">
                  <SheetTitle>Filters</SheetTitle>
                  {activeFilterCount ? (
                    <Button variant="ghost" size="xs" onClick={clearAll}>
                      Clear all
                    </Button>
                  ) : null}
                </SheetHeader>
                <div className="mt-4">{filterControls}</div>
              </SheetContent>
            </Sheet>
          </>
        ) : null}
        {chips.map((c) => (
          <FilterChip key={c.key} label={c.label} value={c.value} onRemove={() => setFilter(c.key, '')} />
        ))}
        {chips.length > 1 ? (
          <Button variant="ghost" size="xs" onClick={clearAll}>
            Clear all
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {props.toolbarExtra}
          <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={cn('size-4', query.isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Bulk bar */}
      {bulkActions.length > 0 && selected.size > 0 ? (
        <div className="sticky top-[calc(var(--header-height)+0.5rem)] z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary-soft px-3 py-2 text-sm shadow-[var(--shadow-pop)]">
          <span className="font-medium">{selected.size} selected</span>
          {bulkActions.map((a) => (
            <Button key={a.label} size="sm" variant={a.variant ?? 'outline'} disabled={busy} onClick={() => void runBulk(a)}>
              {a.icon}
              {a.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      {query.isError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-danger-soft p-4 text-sm">
          <p className="font-medium text-danger-text">Could not load data</p>
          <p className="text-muted-foreground">{query.error.message}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* Table (md+) */}
      {/* At lg+ the table scrolls inside its card so the header stays visible; the page footer (pagination) stays in view. */}
      <div className={cn('hidden overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)] md:block lg:max-h-[calc(100dvh-15rem)] lg:min-h-64 lg:overflow-auto', query.isFetching && 'opacity-80 transition-opacity')}>
        <Table containerClassName="lg:overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-muted shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-0">
            <TableRow>
              {bulkActions.length > 0 ? (
                <TableHead className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={(c) => setSelected(c ? new Set(rows.map(rowKey)) : new Set())} aria-label="Select all" />
                </TableHead>
              ) : null}
              {columns.map((c) => {
                const active = c.sortKey && (state.sort === c.sortKey || state.sort === `-${c.sortKey}`)
                const desc = state.sort === `-${c.sortKey}`
                return (
                  <TableHead key={c.key} className={cn(c.hideBelow && HIDE_CLASS[c.hideBelow], c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.headerClassName)}>
                    {c.sortKey ? (
                      <button type="button" className={cn('-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground', active ? 'text-foreground' : 'text-muted-foreground')} onClick={() => toggleSort(c.sortKey!)}>
                        {c.header}
                        {active ? desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" /> : <ArrowUpDown className="size-3.5 opacity-50" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {bulkActions.length > 0 ? <TableCell /> : null}
                  {columns.map((c) => (
                    <TableCell key={c.key} className={cn(c.hideBelow && HIDE_CLASS[c.hideBelow])}>
                      <Skeleton className="h-4 w-3/4" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length + (bulkActions.length ? 1 : 0)} className="h-auto p-4 whitespace-normal">
                  <EmptyState compact className="border-0 bg-transparent" title={props.emptyTitle ?? 'Nothing here yet'} description={props.emptyDescription} />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const id = rowKey(row)
                const href = rowHref?.(row)
                return (
                  <TableRow
                    key={id}
                    className={cn(href && 'cursor-pointer', selected.has(id) && 'bg-primary-soft hover:bg-primary-soft')}
                    onClick={(e) => {
                      if (!href) return
                      const target = e.target as HTMLElement
                      if (target.closest('a,button,input,[role=checkbox],[data-no-row-click]')) return
                      router.push(href)
                    }}
                  >
                    {bulkActions.length > 0 ? (
                      <TableCell className="w-10">
                        <Checkbox
                          checked={selected.has(id)}
                          onCheckedChange={(c) => {
                            const next = new Set(selected)
                            if (c) next.add(id)
                            else next.delete(id)
                            setSelected(next)
                          }}
                          aria-label="Select row"
                        />
                      </TableCell>
                    ) : null}
                    {columns.map((c) => (
                      <TableCell key={c.key} className={cn(c.hideBelow && HIDE_CLASS[c.hideBelow], c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>
                        {c.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Cards (mobile) */}
      <div className={cn('flex flex-col gap-2 md:hidden', query.isFetching && 'opacity-70')}>
        {query.isPending ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
        ) : rows.length === 0 ? (
          <EmptyState compact title={props.emptyTitle ?? 'Nothing here yet'} description={props.emptyDescription} />
        ) : (
          rows.map((row) => {
            const href = rowHref?.(row)
            const card = <div className="rounded-lg border bg-card p-3.5 shadow-[var(--shadow-card)] transition-colors active:bg-accent">{props.renderMobileCard(row)}</div>
            return href ? (
              <Link key={rowKey(row)} href={href} className="block">
                {card}
              </Link>
            ) : (
              <div key={rowKey(row)}>{card}</div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row sm:text-sm">
        <div className="flex items-center gap-2">
          <span>
            {!meta ? (query.isError ? 'No results' : 'Loading…') : meta.total > 0 ? `${(meta.page - 1) * meta.pageSize + 1}–${Math.min(meta.total, meta.page * meta.pageSize)} of ${meta.total}` : '0 results'}
          </span>
          <Select value={String(state.pageSize)} onValueChange={(v) => update({ pageSize: Number(v) }, { resetPage: true })} items={PAGE_SIZES.map((s) => ({ value: s, label: `${s} / page` }))}>
            <SelectTrigger size="sm" className="w-28" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" className="hidden sm:inline-flex" disabled={!meta || meta.page <= 1} onClick={() => update({ page: 1 })} aria-label="First page">
            <ChevronsLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={!meta || meta.page <= 1} onClick={() => update({ page: state.page - 1 })} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="px-2 tabular-nums text-foreground/80">
            Page {meta?.page ?? 1} / {meta?.totalPages ?? 1}
          </span>
          <Button variant="outline" size="icon-sm" disabled={!meta || meta.page >= meta.totalPages} onClick={() => update({ page: state.page + 1 })} aria-label="Next page">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" className="hidden sm:inline-flex" disabled={!meta || meta.page >= meta.totalPages} onClick={() => update({ page: meta?.totalPages ?? 1 })} aria-label="Last page">
            <ChevronsRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function filterValueLabel(filter: DataTableFilter, value: string): string {
  if (filter.type === 'boolean') return value === 'true' ? 'Yes' : 'No'
  if (filter.type === 'select') return filter.options?.find((o) => o.value === value)?.label ?? value
  if (filter.type === 'date') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
  }
  return value
}

function FilterControl({ filter, value, onChange }: { filter: DataTableFilter; value: string; onChange: (v: string) => void }) {
  if (filter.type === 'select' || filter.type === 'boolean') {
    const options = filter.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : (filter.options ?? [])
    const items = [{ value: ANY, label: filter.placeholder ?? 'Any' }, ...options]
    return (
      <Select value={value || ANY} onValueChange={(v) => onChange(String(v ?? ''))} items={items}>
        <SelectTrigger className="w-full" aria-label={filter.label}>
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
  return (
    <Input
      type={filter.type === 'date' ? 'date' : filter.type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={filter.placeholder}
      className="w-full"
      aria-label={filter.label}
    />
  )
}
