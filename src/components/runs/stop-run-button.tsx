'use client'

import { useState } from 'react'
import { Loader2, Square } from 'lucide-react'
import { api, useApiMutation } from '@/lib/api/hooks'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'

interface CancelResult {
  status: string
  immediate: boolean
}

/**
 * "Stop run": asks the worker to finish its current batch and end the run cleanly.
 * Everything already fetched, enriched, ranked or drafted stays; the rest waits for the next run.
 */
export function StopRunButton({ runId, cancelRequested = false, size = 'sm' }: { runId: string; cancelRequested?: boolean; size?: 'sm' | 'default' }) {
  const [open, setOpen] = useState(false)
  const stop = useApiMutation<void, CancelResult>(() => api.post<CancelResult>(`/api/runs/${runId}/cancel`), {
    invalidate: [['runs'], ['status']],
    onSuccess: () => setOpen(false),
  })
  if (cancelRequested) {
    return (
      <Button size={size} variant="outline" disabled>
        <Loader2 className="size-3.5 animate-spin" /> Stopping after the current batch…
      </Button>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size={size} variant="destructive" />}>
        <Square className="size-3.5" /> Stop run
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[calc(100vw-1.5rem)] max-w-80">
        <PopoverHeader>
          <PopoverTitle>Stop this run?</PopoverTitle>
          <PopoverDescription>The worker finishes the batch it is on (a few seconds to a minute), then stops. Jobs already found, ranked or drafted are kept. Nothing is sent by a run.</PopoverDescription>
        </PopoverHeader>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            Keep running
          </Button>
          <Button size="sm" variant="destructive" disabled={stop.isPending} onClick={() => stop.mutate()}>
            {stop.isPending ? 'Stopping…' : 'Stop run'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
