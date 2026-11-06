'use client'

import { BellRing, Send } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import type { NotificationType } from '@/lib/domain'
import type { GeneralSettings } from '@/lib/settings/schema'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Hint, SectionCard, SwitchRow } from './fields'

const TYPES: Array<{ type: NotificationType; label: string; help: string }> = [
  { type: 'interview', label: 'Interview requests', help: 'Always worth an answer within hours.' },
  { type: 'reply', label: 'Replies from a person', help: 'Questions, positive replies, "apply on our site". Auto-replies and bounces never buzz.' },
  { type: 'review_needed', label: 'Forms and drafts waiting for you', help: 'At most one every 15 minutes.' },
  { type: 'error', label: 'Problems', help: 'Bounce brake, mailbox disconnected, sending paused. At most one every 15 minutes.' },
  { type: 'sent', label: 'Each application sent', help: 'Noisy during a batch; at most one every 15 minutes.' },
  { type: 'run_complete', label: 'Search runs and batches finished', help: 'At most one every 15 minutes.' },
]

/** Settings → General: which notifications also go to your phone (ntfy or Telegram from .env). */
export function PhoneNotifications({ pushEnabled, pushTypes, onChange }: { pushEnabled: boolean; pushTypes: GeneralSettings['pushTypes']; onChange: (patch: Partial<GeneralSettings>) => void }) {
  const status = useApiQuery<{ channel: 'ntfy' | 'telegram' | null }>(['notifications', 'push'], '/api/notifications/push')
  const test = useApiMutation<void, unknown>(() => api.post('/api/notifications/push'), {})
  const channel = status.data?.data.channel ?? null
  const toggle = (type: NotificationType, on: boolean) => onChange({ pushTypes: on ? [...new Set([...pushTypes, type])] : pushTypes.filter((t) => t !== type) })

  return (
    <SectionCard
      title="Phone notifications"
      description="Interview requests and replies need an answer within hours; these reach your phone as well as the bell."
      action={
        channel ? (
          <Badge variant="outline" className="gap-1">
            <BellRing className="size-3" /> {channel === 'ntfy' ? 'ntfy' : 'Telegram'}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Not set up
          </Badge>
        )
      }
    >
      {channel === 'telegram' ? (
        <Hint>
          The Telegram bot also answers commands from your chat: send <code className="font-mono">/help</code> for the list (<code className="font-mono">/status</code>, <code className="font-mono">/todo</code>, <code className="font-mono">/ai</code> and more). Sending email always asks you to confirm first.
        </Hint>
      ) : null}
      {channel ? null : (
        <Hint>
          Set <code className="font-mono">NTFY_TOPIC</code> (install the ntfy app and subscribe to a long random topic name) or <code className="font-mono">TELEGRAM_BOT_TOKEN</code> and{' '}
          <code className="font-mono">TELEGRAM_CHAT_ID</code> in <code className="font-mono">.env</code>, then restart the app and the worker.
        </Hint>
      )}
      <SwitchRow label="Send to my phone" checked={pushEnabled} onCheckedChange={(c) => onChange({ pushEnabled: c })} disabled={!channel} />
      <div className="grid gap-2 sm:grid-cols-2">
        {TYPES.map((t) => (
          <label key={t.type} className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 has-disabled:cursor-not-allowed has-disabled:opacity-60">
            <Checkbox checked={pushTypes.includes(t.type)} onCheckedChange={(c) => toggle(t.type, Boolean(c))} disabled={!channel || !pushEnabled} className="mt-0.5" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="block text-xs text-muted-foreground">{t.help}</span>
            </span>
          </label>
        ))}
      </div>
      <div>
        <Button type="button" size="sm" variant="outline" onClick={() => test.mutate()} disabled={!channel || test.isPending}>
          <Send className="size-3.5" /> Send a test
        </Button>
      </div>
    </SectionCard>
  )
}
