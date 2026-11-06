'use client'

import { useState } from 'react'
import { Globe, Play, Plus, Trash2 } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { fmtAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { EmptyState } from '@/components/shared/page-header'
import { ToneBadge } from '@/components/shared/status-badge'

interface ScrapeTarget {
  id: string
  name: string
  url: string
  enabled: boolean
  linkSelector: string | null
  linkPattern: string | null
  maxLinks: number
  maxPages: number
  requireEmail: boolean
  countryCode: string | null
  waitMs: number
  notes: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  lastFound: number
}

type TargetForm = Omit<ScrapeTarget, 'id' | 'lastRunAt' | 'lastStatus' | 'lastError' | 'lastFound'>

const EMPTY: TargetForm = { name: '', url: '', enabled: true, linkSelector: null, linkPattern: null, maxLinks: 30, maxPages: 1, requireEmail: true, countryCode: null, waitMs: 1500, notes: null }

function TargetDialog({ initial, onSubmit, trigger, title }: { initial: TargetForm; onSubmit: (v: TargetForm) => Promise<unknown>; trigger: React.ReactElement; title: string }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<TargetForm>(initial)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof TargetForm>(k: K, v: TargetForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setForm(initial)
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>The worker opens this page in a headless browser, follows job links, and keeps postings that show an email address.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="t-name">Name</Label>
            <Input id="t-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="IrishJobs software engineer" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-url">List / search page URL</Label>
            <Input id="t-url" value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://example.com/jobs?q={query}&where={location}&page={page}" />
            <p className="text-xs text-muted-foreground">
              Placeholders are filled from Settings → Search: <code className="font-mono">{'{query}'}</code> (your queries), <code className="font-mono">{'{location}'}</code> (this target&apos;s country, or your tier-1 countries), <code className="font-mono">{'{page}'}</code> (1 to max pages).
            </p>
            <p className="text-xs text-muted-foreground">Use {'{page}'} where the page number goes to walk several pages.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="t-pages">Pages</Label>
              <Input id="t-pages" type="number" min={1} max={20} value={form.maxPages} onChange={(e) => set('maxPages', Number(e.target.value) || 1)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-links">Max postings per run</Label>
              <Input id="t-links" type="number" min={1} max={200} value={form.maxLinks} onChange={(e) => set('maxLinks', Number(e.target.value) || 30)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-country">Default country</Label>
              <Input id="t-country" maxLength={2} value={form.countryCode ?? ''} onChange={(e) => set('countryCode', e.target.value.toUpperCase() || null)} placeholder="IE" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-wait">Wait after load (ms)</Label>
              <Input id="t-wait" type="number" min={0} max={15000} step={250} value={form.waitMs} onChange={(e) => set('waitMs', Number(e.target.value) || 0)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-selector">Job link CSS selector (optional)</Label>
            <Input id="t-selector" value={form.linkSelector ?? ''} onChange={(e) => set('linkSelector', e.target.value || null)} placeholder="a.job-title" className="font-mono text-xs" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-pattern">Job URL pattern, regex (optional)</Label>
            <Input id="t-pattern" value={form.linkPattern ?? ''} onChange={(e) => set('linkPattern', e.target.value || null)} placeholder="/job/\d+" className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">Without a selector or pattern, links are picked heuristically (paths containing job, vacancy, career…).</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.requireEmail} onCheckedChange={(c) => set('requireEmail', Boolean(c))} /> Only keep postings that show an email address
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.enabled} onCheckedChange={(c) => set('enabled', Boolean(c))} /> Enabled (included in scheduled runs)
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="t-notes">Notes</Label>
            <Textarea id="t-notes" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !form.name || !form.url}
            onClick={async () => {
              setBusy(true)
              try {
                await onSubmit(form)
                setOpen(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ScrapeTargets() {
  const q = useApiQuery<ScrapeTarget[]>(['scrape-targets'], '/api/scrape-targets', { refetchInterval: 20_000 })
  const create = useApiMutation((v: TargetForm) => api.post('/api/scrape-targets', v), { invalidate: [['scrape-targets']] })
  const update = useApiMutation(({ id, ...v }: Partial<TargetForm> & { id: string }) => api.patch(`/api/scrape-targets/${id}`, v), { invalidate: [['scrape-targets']], silent: true })
  const remove = useApiMutation((id: string) => api.delete(`/api/scrape-targets/${id}`), { invalidate: [['scrape-targets']], successMessage: 'Target removed' })
  const run = useApiMutation((id: string) => api.post(`/api/scrape-targets/${id}`), { invalidate: [['scrape-targets']] })
  const targets = q.data?.data ?? []

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="size-4" /> Browser scraping
          </CardTitle>
          <CardDescription>
            For sites without an API. The worker opens each list page in headless Chromium, follows job links, reads the posting, keeps the ones that expose an email address, and lets Gemini turn the page into
            the fields you see on the Jobs page. It respects robots.txt, visits one page at a time with pauses, and never logs in anywhere. Keep volumes small and check each site&apos;s terms before enabling a target.
            Short listings from Jooble and Adzuna are also opened in the browser automatically (deep fetch, Settings → Search).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <TargetDialog
            title="Add scrape target"
            initial={EMPTY}
            onSubmit={(v) => create.mutateAsync(v)}
            trigger={
              <Button size="sm">
                <Plus className="size-4" /> Add target
              </Button>
            }
          />
          <p className="text-xs text-muted-foreground">Requires Chromium on the worker machine: <code className="rounded bg-muted px-1">npx playwright install chromium</code></p>
        </CardContent>
      </Card>

      {q.isPending ? null : targets.length === 0 ? (
        <EmptyState title="No scrape targets yet" description="Add a search page from a job site that lists employer emails, then run it once to see what it finds." />
      ) : (
        <div className="grid gap-3">
          {targets.map((t) => (
            <Card key={t.id} className={t.enabled ? undefined : 'opacity-75'}>
              <CardContent className="flex flex-col gap-3 pt-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{t.name}</p>
                    {t.lastStatus ? <ToneBadge tone={t.lastStatus === 'ok' ? 'success' : t.lastStatus === 'error' ? 'danger' : 'muted'}>{t.lastStatus}</ToneBadge> : <ToneBadge tone="muted">never run</ToneBadge>}
                    {t.requireEmail ? <ToneBadge tone="info">email required</ToneBadge> : null}
                    {t.countryCode ? <ToneBadge tone="neutral">{t.countryCode}</ToneBadge> : null}
                  </div>
                  <a href={t.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-muted-foreground underline-offset-2 hover:underline">
                    {t.url}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {t.maxPages} page(s) · up to {t.maxLinks} postings · wait {t.waitMs} ms{t.linkSelector ? ` · selector ${t.linkSelector}` : ''}{t.linkPattern ? ` · pattern /${t.linkPattern}/` : ''}
                  </p>
                  {t.lastRunAt ? (
                    <p className="text-xs text-muted-foreground">
                      Last run {fmtAgo(t.lastRunAt)}: {t.lastFound} job(s){t.lastError ? <span className="text-danger-text"> · {t.lastError}</span> : null}
                    </p>
                  ) : null}
                  {t.notes ? <p className="text-xs text-muted-foreground">{t.notes}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={t.enabled} onCheckedChange={(c) => update.mutate({ id: t.id, enabled: Boolean(c) })} /> Enabled
                  </label>
                  <Button size="sm" variant="outline" onClick={() => run.mutate(t.id)} disabled={run.isPending}>
                    <Play className="size-3.5" /> Run now
                  </Button>
                  <TargetDialog
                    title="Edit target"
                    initial={{ name: t.name, url: t.url, enabled: t.enabled, linkSelector: t.linkSelector, linkPattern: t.linkPattern, maxLinks: t.maxLinks, maxPages: t.maxPages, requireEmail: t.requireEmail, countryCode: t.countryCode, waitMs: t.waitMs, notes: t.notes }}
                    onSubmit={(v) => update.mutateAsync({ id: t.id, ...v })}
                    trigger={
                      <Button size="sm" variant="ghost">
                        Edit
                      </Button>
                    }
                  />
                  <ConfirmButton size="icon-sm" variant="ghost" title="Remove this target?" description="Jobs already found stay in the database." onConfirm={() => remove.mutateAsync(t.id)} aria-label="Delete">
                    <Trash2 className="size-4" />
                  </ConfirmButton>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
