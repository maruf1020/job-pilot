'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, useApiQuery } from '@/lib/api/hooks'
import type { SyncStatus } from '@/lib/inbox/sync'
import { fmtAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const POLL_MS = 5_000
const GIVE_UP_MS = 2 * 60_000

/** Last sync status (GET /api/inbox/sync): companies that offered a next step, running, last check time. */
export function useSyncStatus() {
  return useApiQuery<SyncStatus>(['inbox', 'sync'], '/api/inbox/sync', { refetchInterval: 60_000 })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * "Sync" (plan-ui-redesign.md 7.1): checks Gmail now, waits until the worker has read it (polling
 * every 5 s for up to 2 minutes), then says how many companies offered a next step and refreshes
 * the inbox, the applications and Today.
 */
export function SyncButton({ className, size = 'sm', variant = 'outline', showLast = false }: { className?: string; size?: 'sm' | 'default' | 'xs'; variant?: 'outline' | 'default' | 'ghost'; showLast?: boolean }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const status = useSyncStatus()
  const last = status.data?.data.lastSyncAt

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = async () => {
    setBusy(true)
    try {
      await api.post('/api/inbox/sync')
      // A second before the click, so a quick finish by the worker still counts.
      const since = Date.now() - 1_000
      let s: SyncStatus | null = null
      let finished = false
      while (alive.current && Date.now() - since < GIVE_UP_MS) {
        await sleep(POLL_MS)
        s = (await api.get<SyncStatus>('/api/inbox/sync')).data
        if (!s.running && s.lastSyncAt && new Date(s.lastSyncAt).getTime() >= since) {
          finished = true
          break
        }
      }
      if (!alive.current) return
      for (const k of [['inbox'], ['applications'], ['dashboard']]) void qc.invalidateQueries({ queryKey: k })
      if (finished && s) {
        const n = s.nextSteps.count
        const open = s.nextSteps.open
        toast.success(`Checked Gmail: ${n} ${n === 1 ? 'company' : 'companies'} offered a next step${open ? ` (${open} waiting for your answer)` : ''}`)
      } else toast.message('The Gmail check is still running in the worker; the inbox updates when it finishes')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the Gmail check')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {showLast && last ? <span className="hidden text-xs text-muted-foreground md:inline">Checked {fmtAgo(last)}</span> : null}
      <Button size={size} variant={variant} onClick={() => void run()} disabled={busy} aria-label="Check Gmail for replies now">
        <RefreshCw className={cn(busy && 'animate-spin')} /> {busy ? 'Syncing…' : 'Sync'}
      </Button>
    </span>
  )
}
