'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

export interface CooldownInfo {
  message: string
  conflictApplicationId: string
}

/** Shown on job and application pages when this company (and location) was applied to recently. */
export function CooldownBanner({ cooldown }: { cooldown: CooldownInfo | null | undefined }) {
  if (!cooldown) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-text">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p>
        {cooldown.message}.{' '}
        <Link href={`/applications/${cooldown.conflictApplicationId}`} className="font-medium underline">
          See that application
        </Link>
        . Auto-apply skips this company until then; applying by hand asks you to confirm.
      </p>
    </div>
  )
}

/**
 * Wraps a manual apply action: with a cooldown warning it first asks "Apply anyway?",
 * and only then runs the action with ignoreCooldown=true. Without a warning it runs directly.
 */
export function useCooldownConfirm(cooldown: CooldownInfo | null | undefined) {
  const [pending, setPending] = useState<null | ((ignoreCooldown: boolean) => void)>(null)
  const guard = (run: (ignoreCooldown: boolean) => void) => {
    if (cooldown) setPending(() => run)
    else run(false)
  }
  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You applied to this company recently</AlertDialogTitle>
          <AlertDialogDescription>{cooldown?.message}. Applying again this soon can look careless to the same recruiter. Apply anyway?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const run = pending
              setPending(null)
              run?.(true)
            }}
          >
            Apply anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { guard, dialog }
}
