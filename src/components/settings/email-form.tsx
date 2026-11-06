'use client'

import { AlertTriangle } from 'lucide-react'
import type { EmailConfig } from '@/lib/settings/schema'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Field, NumberInput, SectionCard, SwitchRow } from './fields'
import { SaveBar, SettingsError, SettingsLoading, useSettingsSection } from './settings-form'

const PROVIDER_ITEMS = [
  { value: 'gmail', label: 'Gmail (OAuth)' },
  { value: 'smtp', label: 'SMTP' },
]

/** Mon..Sun shown in that order; values follow JS getDay() (0 = Sunday). */
const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

function isProvider(v: string): v is EmailConfig['provider'] {
  return v === 'gmail' || v === 'smtp'
}

export function EmailForm() {
  const form = useSettingsSection('email')

  if (form.isPending) return <SettingsLoading />
  if (form.isError || !form.value) return <SettingsError error={form.error} onRetry={() => void form.refetch()} />

  const v = form.value
  const set = form.set

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Sending" description="Which provider sends applications and how many per day.">
        <div className={v.sendingEnabled ? 'rounded-lg border border-success/30 bg-success-soft p-3' : 'rounded-lg border border-warning/40 bg-warning-soft p-3'}>
          <SwitchRow
            label={v.sendingEnabled ? 'Sending is allowed' : 'Sending is paused'}
            help={
              v.sendingEnabled
                ? 'The worker sends queued applications and follow-ups inside the send window. Switch off to stop all automatic sending at once.'
                : 'Nothing leaves the app: queued applications and follow-ups wait, auto-send cannot queue. Only the explicit "Send now" button on an application sends. Switch on when you want the queue to go out.'
            }
            checked={v.sendingEnabled}
            onCheckedChange={(c) => set({ sendingEnabled: c })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider" htmlFor="provider" help="Gmail needs the OAuth connection above; SMTP uses the SMTP_* environment variables.">
            <Select
              value={v.provider}
              onValueChange={(val) => {
                const next = String(val ?? '')
                if (isProvider(next)) set({ provider: next })
              }}
              items={PROVIDER_ITEMS}
            >
              <SelectTrigger id="provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_ITEMS.map((it) => (
                  <SelectItem key={it.value} value={it.value}>
                    {it.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Daily send cap" htmlFor="daily-cap" help="Maximum emails sent or queued per day (0–200).">
            <NumberInput id="daily-cap" integer min={0} max={200} value={v.dailySendCap} onValueChange={(n) => set({ dailySendCap: n })} />
          </Field>
        </div>
        <SwitchRow
          label="Auto-send approved drafts"
          help={
            <span className="flex items-start gap-1.5 text-warning-text">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Only turn this on after reviewing ~20 drafts. Emails above the auto-send threshold go out without you seeing them.
            </span>
          }
          checked={v.autoSend}
          onCheckedChange={(c) => set({ autoSend: c })}
        />
        <SwitchRow label="Attach resume" help="Attach the active resume PDF to every application email." checked={v.attachResume} onCheckedChange={(c) => set({ attachResume: c })} />
        <SwitchRow label="CC myself" help="Send a copy of every outgoing email to your own address." checked={v.ccSelf} onCheckedChange={(c) => set({ ccSelf: c })} />
        <SwitchRow
          label="Allow guessed addresses"
          help="When no address is found, contact discovery guesses careers@, jobs@ … on the company domain. With this on, auto-send may use them; a bounce moves to the next guess automatically, up to 10, then the job goes back to manual."
          checked={v.allowGuessedEmails}
          onCheckedChange={(c) => set({ allowGuessedEmails: c })}
        />
      </SectionCard>

      <SectionCard title="Send window" description="Emails are only sent on these days and between these times, in the job's local time zone.">
        <SwitchRow
          label="Send as soon as ready"
          help="Ignore the window below: each application goes out right after it is prepared, still with the random gap between emails. Off = wait for the window (more natural send times for the recruiter)."
          checked={v.sendImmediately}
          onCheckedChange={(c) => set({ sendImmediately: c })}
        />
        <div className={v.sendImmediately ? 'pointer-events-none flex flex-col gap-1.5 opacity-50' : 'flex flex-col gap-1.5'}>
          <Label>Days</Label>
          <ToggleGroup
            multiple
            variant="outline"
            size="sm"
            className="flex-wrap"
            value={v.sendWindow.days.map(String)}
            onValueChange={(vals) => {
              const days = vals.map((d) => Number(d)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
              set({ sendWindow: { ...v.sendWindow, days: [...new Set(days)].sort((a, b) => a - b) } })
            }}
          >
            {DAYS.map((d) => (
              <ToggleGroupItem key={d.value} value={String(d.value)} aria-label={d.label} className="min-w-11">
                {d.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {v.sendWindow.days.length === 0 ? <p className="text-xs text-danger-text">No days selected: nothing will be sent.</p> : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start" htmlFor="window-start">
            <Input id="window-start" type="time" value={v.sendWindow.start} onChange={(e) => set({ sendWindow: { ...v.sendWindow, start: e.target.value } })} />
          </Field>
          <Field label="End" htmlFor="window-end">
            <Input id="window-end" type="time" value={v.sendWindow.end} onChange={(e) => set({ sendWindow: { ...v.sendWindow, end: e.target.value } })} />
          </Field>
          <Field label="Min gap between emails (minutes)" htmlFor="min-gap" help="The sender never sends two emails closer than this (0.1 = 6 seconds). A personal Gmail allows about 500 emails a day; much faster than one every few seconds risks a temporary sending block from Google.">
            <NumberInput id="min-gap" min={0} step={0.05} value={v.minGapMinutes} onValueChange={(n) => set({ minGapMinutes: n })} />
          </Field>
          <Field label="Max gap between emails (minutes)" htmlFor="max-gap" help="A random delay between min and max keeps sending human-paced.">
            <NumberInput id="max-gap" min={0} step={0.05} value={v.maxGapMinutes} onValueChange={(n) => set({ maxGapMinutes: n })} />
          </Field>
          <Field label="Company cooldown (days)" htmlFor="cooldown" help="One application per company within this many days (10 to 20 is a good range). Enforced when drafting, queueing and sending, including Send now.">
            <NumberInput id="cooldown" integer min={0} max={180} value={v.companyCooldownDays} onValueChange={(n) => set({ companyCooldownDays: n })} />
          </Field>
          <Field label="Cooldown applies per" htmlFor="cooldown-scope" help="Per company and country lets you apply to the same company's Dublin and Berlin offices; per company allows one application anywhere.">
            <Select value={v.companyCooldownScope} onValueChange={(val) => set({ companyCooldownScope: val === 'company' ? 'company' : 'company_country' })} items={[{ value: 'company_country', label: 'Company and country' }, { value: 'company', label: 'Company (any location)' }]}>
              <SelectTrigger id="cooldown-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="company_country">Company and country</SelectItem>
                <SelectItem value="company">Company (any location)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Follow-ups and replies" description="What happens after an email goes out.">
        <SwitchRow label="Follow-ups" help="Due follow-ups appear on the Applications page; each goes out only after you approve it there." checked={v.followUp.enabled} onCheckedChange={(c) => set({ followUp: { ...v.followUp, enabled: c } })} />
        <SwitchRow label="Second follow-up" help="A second touch the same number of days after the first (two in total), again after your approval." checked={v.followUp.second} onCheckedChange={(c) => set({ followUp: { ...v.followUp, second: c } })} disabled={!v.followUp.enabled} />
        <Field label="Bounce brake (%)" htmlFor="bounce-brake" help="Automatic sending pauses when bounces in the last 7 days exceed this share of sends. 0 = off.">
          <NumberInput id="bounce-brake" min={0} max={50} value={v.bounceBrakePercent} onValueChange={(n) => set({ bounceBrakePercent: n })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Follow up after (days)" htmlFor="follow-up-days" help="1–60.">
            <NumberInput id="follow-up-days" integer min={1} max={60} value={v.followUp.afterDays} onValueChange={(n) => set({ followUp: { ...v.followUp, afterDays: n } })} disabled={!v.followUp.enabled} />
          </Field>
          <Field label="Check inbox every (minutes)" htmlFor="reply-poll" help="5–1440. How often replies are fetched and classified.">
            <NumberInput id="reply-poll" integer min={5} max={1440} value={v.replyPollMinutes} onValueChange={(n) => set({ replyPollMinutes: n })} />
          </Field>
          <Field label="Mark “no response” after (days)" htmlFor="no-response" help="Applications without a reply move to No response.">
            <NumberInput id="no-response" integer min={1} value={v.noResponseAfterDays} onValueChange={(n) => set({ noResponseAfterDays: n })} />
          </Field>
        </div>
      </SectionCard>

      <SaveBar dirty={form.dirty} saving={form.saving} onSave={form.save} onDiscard={form.discard} error={form.saveError} />
    </div>
  )
}
