'use client'

import Link from 'next/link'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-8 w-full max-w-lg rounded-xl border bg-card p-6 text-center shadow-[var(--shadow-card)]">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger-text">
        <AlertTriangle className="size-5" />
      </div>
      <h1 className="text-base font-semibold text-foreground">This page could not load</h1>
      <p className="mt-1 text-sm wrap-break-word text-muted-foreground">{error.message || 'An unexpected error happened.'}</p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">Ref {error.digest}</p> : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw className="size-4" /> Try again
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/dashboard" />}>
          Go to Today
        </Button>
      </div>
    </div>
  )
}
