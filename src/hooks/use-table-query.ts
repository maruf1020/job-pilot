'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'

export interface TableState {
  page: number
  pageSize: number
  sort: string | null
  q: string
  filters: Record<string, string>
}

const FILTER_RE = /^filter\[([^\]]+)\](?:\[([a-z]+)\])?$/

/**
 * URL-synced table state: ?page=&pageSize=&sort=-field&q=&filter[x]=...
 * The same querystring is forwarded to the API, so links are shareable.
 */
export function useTableQuery(defaults: Partial<Pick<TableState, 'pageSize' | 'sort'>> = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const state = useMemo<TableState>(() => {
    const filters: Record<string, string> = {}
    for (const [k, v] of sp.entries()) {
      const m = FILTER_RE.exec(k)
      if (m) filters[m[2] ? `${m[1]}[${m[2]}]` : m[1]] = v
    }
    return {
      page: Math.max(1, Number(sp.get('page') ?? 1) || 1),
      pageSize: Number(sp.get('pageSize') ?? defaults.pageSize ?? 20) || 20,
      sort: sp.get('sort') ?? defaults.sort ?? null,
      q: sp.get('q') ?? '',
      filters,
    }
  }, [sp, defaults.pageSize, defaults.sort])

  const update = useCallback(
    (patch: Partial<TableState>, opts: { resetPage?: boolean } = {}) => {
      const next = new URLSearchParams(sp.toString())
      const merged: TableState = { ...state, ...patch, filters: patch.filters ?? state.filters }
      if (opts.resetPage) merged.page = 1
      next.delete('page')
      next.delete('pageSize')
      next.delete('sort')
      next.delete('q')
      for (const k of [...next.keys()]) if (k.startsWith('filter[')) next.delete(k)
      if (merged.page > 1) next.set('page', String(merged.page))
      if (merged.pageSize !== (defaults.pageSize ?? 20)) next.set('pageSize', String(merged.pageSize))
      if (merged.sort && merged.sort !== (defaults.sort ?? null)) next.set('sort', merged.sort)
      if (merged.q) next.set('q', merged.q)
      for (const [k, v] of Object.entries(merged.filters)) {
        if (v === '' || v == null) continue
        const m = /^([^[]+)(?:\[([a-z]+)\])?$/.exec(k)
        next.set(m?.[2] ? `filter[${m[1]}][${m[2]}]` : `filter[${k}]`, v)
      }
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [sp, state, router, pathname, defaults.pageSize, defaults.sort],
  )

  /** Query string to forward to the API (includes defaults so the server sees them). */
  const apiQuery = useMemo(() => {
    const out = new URLSearchParams()
    out.set('page', String(state.page))
    out.set('pageSize', String(state.pageSize))
    if (state.sort) out.set('sort', state.sort)
    if (state.q) out.set('q', state.q)
    for (const [k, v] of Object.entries(state.filters)) {
      if (!v) continue
      const m = /^([^[]+)(?:\[([a-z]+)\])?$/.exec(k)
      out.set(m?.[2] ? `filter[${m[1]}][${m[2]}]` : `filter[${k}]`, v)
    }
    return out.toString()
  }, [state])

  return { state, update, apiQuery }
}
