'use client'

import { ChevronDown } from 'lucide-react'
import { api, useApiMutation } from '@/lib/api/hooks'
import { REPLY_CLASSIFICATIONS } from '@/lib/domain'
import { REPLY_LABEL } from '@/lib/format'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ReplyBadge } from '@/components/shared/status-badge'

/**
 * The reply's type as a menu: pick another one when the classifier got it wrong. The
 * application moves with it (interview, rejected, back to sent).
 */
export function ReplyTypeMenu({ messageId, classification }: { messageId: string; classification: string | null }) {
  const change = useApiMutation<{ classification: string }, unknown>((v) => api.patch(`/api/inbox/${messageId}`, v), {
    invalidate: [['inbox'], ['applications'], ['dashboard']],
    successMessage: 'Reply type changed',
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" className="inline-flex items-center gap-0.5 rounded-md hover:opacity-80 disabled:opacity-50" aria-label="Change the reply type" disabled={change.isPending}>
            <ReplyBadge classification={classification} />
            <ChevronDown className="size-3 text-muted-foreground" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-56" data-no-row-click>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">Wrong type? Change it</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {REPLY_CLASSIFICATIONS.map((c) => (
            <DropdownMenuItem key={c} disabled={c === classification} onClick={() => change.mutate({ classification: c })}>
              {REPLY_LABEL[c].label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
