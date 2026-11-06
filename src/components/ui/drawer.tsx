'use client'

import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { cn } from '@/lib/utils'

/** Bottom sheet for phones (vaul): drag to dismiss, respects the safe area. */
function Drawer({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTrigger({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerClose({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerContent({ className, children, ...props }: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Overlay data-slot="drawer-overlay" className="fixed inset-0 z-50 bg-black/40" />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-2xl border-t bg-popover pb-[max(env(safe-area-inset-bottom),0.75rem)] text-popover-foreground shadow-[var(--shadow-pop)] outline-none',
          className,
        )}
        {...props}
      >
        <div aria-hidden className="mx-auto mt-2.5 mb-1 h-1 w-10 shrink-0 rounded-full bg-border-strong" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="drawer-header" className={cn('flex flex-col gap-0.5 px-4 pt-2 pb-3', className)} {...props} />
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return <DrawerPrimitive.Title data-slot="drawer-title" className={cn('text-base font-semibold', className)} {...props} />
}

function DrawerDescription({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return <DrawerPrimitive.Description data-slot="drawer-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger }
