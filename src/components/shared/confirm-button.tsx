'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface ConfirmButtonProps extends Omit<React.ComponentProps<typeof Button>, 'onClick' | 'title'> {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  onConfirm: () => Promise<unknown> | unknown
  children: ReactNode
}

/** A button that asks before doing something hard to undo. */
export function ConfirmButton({ title, description, confirmLabel = 'Confirm', onConfirm, children, ...buttonProps }: ConfirmButtonProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button {...buttonProps} />}>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={async (e) => {
              e.preventDefault()
              setBusy(true)
              try {
                await onConfirm()
                setOpen(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
