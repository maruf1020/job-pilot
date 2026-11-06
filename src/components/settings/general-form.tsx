'use client'

import { useState } from 'react'
import { CalendarClock, PauseCircle } from 'lucide-react'
import { useStatus } from '@/components/layout/status-chip'
import { fmtIn } from '@/lib/format'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, Hint, NumberInput, SectionCard, SwitchRow } from './fields'
import { PhoneNotifications } from './phone-notifications'
import { SaveBar, SettingsError, SettingsLoading, useSettingsSection } from './settings-form'

const INTERVAL_PRESETS = [
  { value: 60, label: 'Every hour' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Twice a day' },
  { value: 1440, label: 'Daily' },
  { value: 2880, label: 'Every 2 days' },
] as const

const CUSTOM = 'custom'
const INTERVAL_ITEMS = [...INTERVAL_PRESETS.map((p) => ({ value: String(p.value), label: p.label })), { value: CUSTOM, label: 'Custom…' }]

/** Every IANA zone the browser knows, UTC first; a short fallback list for browsers without supportedValuesOf. */
function timeZoneOptions(): string[] {
  let zones: string[] = []
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    zones = []
  }
  if (!zones.length) zones = ['Europe/London', 'Europe/Lisbon', 'Europe/Berlin', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Australia/Sydney']
  return ['UTC', ...zones.filter((z) => z !== 'UTC')]
}

/** The browser's own zone, suggested when the setting is still the UTC default. */
function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export function GeneralForm() {
  const form = useSettingsSection('general')
  const status = useStatus()
  const [customInterval, setCustomInterval] = useState(false)
  const [zones] = useState(timeZoneOptions)
  const [localZone] = useState(browserTimeZone)

  if (form.isPending) return <SettingsLoading />
  if (form.isError || !form.value) return <SettingsError error={form.error} onRetry={() => void form.refetch()} />

  const v = form.value
  const set = form.set
  const isPreset = INTERVAL_PRESETS.some((p) => p.value === v.searchIntervalMinutes)
  const intervalSelect = customInterval || !isPreset ? CUSTOM : String(v.searchIntervalMinutes)
  const s = status.data?.data

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Job search schedule" description="How often the worker looks for new jobs.">
        <SwitchRow label="Automatic search" help="Pause this to stop scheduled runs. You can still start a run manually from the Runs page." checked={v.searchEnabled} onCheckedChange={(c) => set({ searchEnabled: c })} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Search interval" htmlFor="search-interval">
            <Select
              value={intervalSelect}
              onValueChange={(val) => {
                const next = String(val ?? '')
                if (next === CUSTOM) {
                  setCustomInterval(true)
                  return
                }
                setCustomInterval(false)
                set({ searchIntervalMinutes: Number(next) })
              }}
              items={INTERVAL_ITEMS}
            >
              <SelectTrigger id="search-interval" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_ITEMS.map((it) => (
                  <SelectItem key={it.value} value={it.value}>
                    {it.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {intervalSelect === CUSTOM ? (
            <Field label="Custom interval (minutes)" htmlFor="search-interval-custom" help="Between 30 minutes and 7 days (10080).">
              <NumberInput id="search-interval-custom" integer min={30} max={10080} value={v.searchIntervalMinutes} onValueChange={(n) => set({ searchIntervalMinutes: n })} />
            </Field>
          ) : null}
        </div>

        <Hint>
          {s ? (
            s.searchEnabled && v.searchEnabled ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <CalendarClock className="size-3.5" />
                <span>
                  Next run <strong className="text-foreground">{fmtIn(s.nextRunAt)}</strong>
                </span>
                <span className="text-muted-foreground/70">·</span>
                <span>
                  cron <code className="rounded bg-background px-1 font-mono">{s.cron}</code>
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <PauseCircle className="size-3.5" /> Scheduled search is paused{!s.searchEnabled && v.searchEnabled ? ' (save to resume)' : ''}.
              </span>
            )
          ) : (
            'Loading schedule…'
          )}
        </Hint>
      </SectionCard>

      <SectionCard title="Time zone" description="Used for the daily digest and for showing local times.">
        <Field label="IANA time zone" htmlFor="timezone" help="Start typing to pick a zone, or enter any IANA name such as Europe/Paris.">
          <Input id="timezone" list="timezone-options" value={v.timezone} onChange={(e) => set({ timezone: e.target.value })} placeholder={localZone ?? 'UTC'} autoComplete="off" />
          <datalist id="timezone-options">
            {zones.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </Field>
        {localZone && localZone !== v.timezone ? (
          <Hint>
            This browser is in <strong className="text-foreground">{localZone}</strong>.{' '}
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => set({ timezone: localZone })}>
              Use it
            </button>
          </Hint>
        ) : null}
      </SectionCard>

      <SectionCard title="Daily digest" description="One email a day with new matches, drafts waiting for review and replies.">
        <SwitchRow label="Send daily digest" checked={v.digestEnabled} onCheckedChange={(c) => set({ digestEnabled: c })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Send at (hour, local time)" htmlFor="digest-hour" help="0–23 in the time zone above.">
            <NumberInput id="digest-hour" integer min={0} max={23} value={v.digestHourLocal} onValueChange={(n) => set({ digestHourLocal: n })} disabled={!v.digestEnabled} />
          </Field>
          <Field label="Digest email" htmlFor="digest-email" help="Leave empty to use your login email. Test emails also go here.">
            <Input
              id="digest-email"
              type="email"
              value={v.digestEmail ?? ''}
              onChange={(e) => set({ digestEmail: e.target.value.trim() === '' ? null : e.target.value })}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
        </div>
      </SectionCard>

      <PhoneNotifications pushEnabled={v.pushEnabled} pushTypes={v.pushTypes} onChange={set} />

      <SaveBar dirty={form.dirty} saving={form.saving} onSave={form.save} onDiscard={form.discard} error={form.saveError} />
    </div>
  )
}
