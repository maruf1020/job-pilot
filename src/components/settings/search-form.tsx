'use client'

import { PROFESSIONS } from '@/lib/candidate/context'
import { EUROPE_COUNTRIES, SOURCE_IDS, SOURCE_LABELS, SOURCE_NOTES, type SourceId } from '@/lib/domain'
import { flagEmoji } from '@/lib/format'
import { OUTSIDE_EUROPE_NAMES, OUTSIDE_EUROPE_TARGETS, type OutsideEuropeTarget } from '@/lib/regions'
import type { SearchConfig } from '@/lib/settings/schema'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Field, Hint, NumberInput, SectionCard, SwitchRow } from './fields'
import { SaveBar, SettingsError, SettingsLoading, useSettingsSection } from './settings-form'
import { TagInput } from './tag-input'

type Sources = SearchConfig['sources']
type ProfessionId = SearchConfig['profession']

const PROFESSION_ITEMS = PROFESSIONS.map((p) => ({ value: p.id, label: p.label }))
const isProfession = (v: string): v is ProfessionId => PROFESSIONS.some((p) => p.id === v)

function sourceHelp(id: SourceId): { text: string; warning?: string } {
  const n = SOURCE_NOTES[id]
  if (!n) return { text: '' }
  return { text: n.needs ? `${n.note} Needs ${n.needs}.` : n.note, warning: n.warning }
}

const COUNTRY_LIST = Object.entries(EUROPE_COUNTRIES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name))

const ALL_COUNTRY_CODES = COUNTRY_LIST.map((c) => c.code)

function normalizeCountry(raw: string): string | null {
  const code = raw.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : null
}

function renderCountryTag(code: string) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden>{flagEmoji(code)}</span>
      {code}
    </span>
  )
}

export function SearchForm() {
  const form = useSettingsSection('search')

  if (form.isPending) return <SettingsLoading />
  if (form.isError || !form.value) return <SettingsError error={form.error} onRetry={() => void form.refetch()} />

  const v = form.value
  const set = form.set
  const tiers: string[][] = [0, 1, 2].map((i) => v.priorityTiers[i] ?? [])

  const setTier = (index: number, codes: string[]) => {
    const next = tiers.map((t, i) => (i === index ? codes : t))
    set({ priorityTiers: next })
  }
  const toggleCountry = (code: string, on: boolean) => {
    set({ countries: on ? [...new Set([...v.countries, code])] : v.countries.filter((c) => c !== code) })
  }
  const outside = v.outsideEurope ?? []
  const toggleOutside = (code: OutsideEuropeTarget, on: boolean) => {
    set({ outsideEurope: on ? [...new Set([...outside, code])] : outside.filter((c) => c !== code) })
  }
  const updateSource = (id: SourceId, patch: { enabled?: boolean; maxPages?: number; dailyBudget?: number }) => {
    const sources: Sources = { ...v.sources, [id]: { ...v.sources[id], ...patch } }
    set({ sources })
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="What you look for" description="Your field and target titles decide which titles the sources keep, the role check before ranking and the title points. Onboarding fills these from your profile.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Profession" htmlFor="profession" help="Picks the title words of your field (a designer gets design jobs, a data analyst data jobs).">
            <Select
              value={v.profession}
              onValueChange={(val) => {
                const next = String(val ?? '')
                if (isProfession(next)) set({ profession: next })
              }}
              items={PROFESSION_ITEMS}
            >
              <SelectTrigger id="profession" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROFESSION_ITEMS.map((it) => (
                  <SelectItem key={it.value} value={it.value}>
                    {it.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Target titles" htmlFor="target-titles" help="Titles with all the words of one of these always count as your field.">
            <TagInput id="target-titles" value={v.targetTitles ?? []} onChange={(targetTitles) => set({ targetTitles })} placeholder="e.g. Product Designer" />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Search queries" description="Each query is sent to every enabled source, per country where the source needs a location.">
        <Field label="Queries" htmlFor="queries" help="Press Enter or comma to add, two characters minimum. Empty = only sources that need no query run.">
          <TagInput id="queries" value={v.queries} onChange={(queries) => set({ queries })} placeholder="e.g. ux designer" normalize={(s) => (s.length >= 2 ? s.toLowerCase() : null)} />
        </Field>
        <Field label="Exclude title keywords" htmlFor="exclude-keywords" help="Jobs whose title contains any of these are dropped before ranking.">
          <TagInput id="exclude-keywords" value={v.excludeTitleKeywords} onChange={(excludeTitleKeywords) => set({ excludeTitleKeywords })} placeholder="e.g. intern" normalize={(s) => s.toLowerCase()} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Max jobs per run" htmlFor="max-jobs" help="10–5000. Stops fetching once reached.">
            <NumberInput id="max-jobs" integer min={10} max={5000} value={v.maxJobsPerRun} onValueChange={(n) => set({ maxJobsPerRun: n })} />
          </Field>
          <Field label="Max age (days)" htmlFor="max-days" help="Ignore postings older than this.">
            <NumberInput id="max-days" integer min={1} max={365} value={v.maxDaysOld} onValueChange={(n) => set({ maxDaysOld: n })} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Countries"
        description="Countries to actively query on sources that need a location."
        action={
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="xs" onClick={() => set({ countries: ALL_COUNTRY_CODES })}>
              All
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={() => set({ countries: [] })}>
              None
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-0.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {COUNTRY_LIST.map(({ code, name }) => {
            const checked = v.countries.includes(code)
            return (
              <label key={code} className={cn('flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted sm:text-sm', checked && 'bg-muted/60')}>
                <Checkbox checked={checked} onCheckedChange={(c) => toggleCountry(code, c)} aria-label={name} />
                <span aria-hidden className="text-base leading-none">
                  {flagEmoji(code)}
                </span>
                <span className="min-w-0 truncate">{name}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{code}</span>
              </label>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {v.countries.length} selected{v.countries.length === 0 ? ' — pick at least one.' : '.'}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <SwitchRow label="Include the UK" help="Also query UK sources and keep GB postings." checked={v.includeUk} onCheckedChange={(c) => set({ includeUk: c })} />
          <SwitchRow label="Include remote" help="Keep Europe-wide remote postings without a fixed country." checked={v.includeRemote} onCheckedChange={(c) => set({ includeRemote: c })} />
          <SwitchRow label="Remote only" help="Drop postings marked on-site or hybrid." checked={v.remoteOnly ?? false} onCheckedChange={(c) => set({ remoteOnly: c, ...(c ? { includeRemote: true } : {}) })} />
        </div>
      </SectionCard>

      <SectionCard title="Countries outside Europe" description="Also search and apply in these countries. If you need a visa there, only postings that state sponsorship get through (Canada: Global Talent Stream or LMIA wording; Australia: 482 or sponsor wording; USA: employers outside the H-1B lottery that say they sponsor), because the visa rules allow little else.">
        <div className="grid grid-cols-2 gap-0.5 sm:grid-cols-4">
          {OUTSIDE_EUROPE_TARGETS.map((code) => {
            const checked = outside.includes(code)
            return (
              <label key={code} className={cn('flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted sm:text-sm', checked && 'bg-muted/60')}>
                <Checkbox checked={checked} onCheckedChange={(c) => toggleOutside(code, c)} aria-label={OUTSIDE_EUROPE_NAMES[code]} />
                <span aria-hidden className="text-base leading-none">
                  {flagEmoji(code)}
                </span>
                <span className="min-w-0 truncate">{OUTSIDE_EUROPE_NAMES[code]}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{code}</span>
              </label>
            )
          })}
        </div>
      </SectionCard>

      <SectionCard title="Country priority" description="Ordered tiers, highest first. Ranking awards more points for tier 1 than tier 3; codes not listed count as “other EU”.">
        <div className="grid gap-3 md:grid-cols-3">
          {tiers.map((codes, i) => (
            <Field key={i} label={`Tier ${i + 1}`} htmlFor={`tier-${i + 1}`} help={i === 0 ? 'Two-letter ISO codes, e.g. PT' : undefined}>
              <TagInput id={`tier-${i + 1}`} value={codes} onChange={(next) => setTier(i, next)} placeholder="e.g. PT, ES" normalize={normalizeCountry} renderTag={renderCountryTag} />
            </Field>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Search rotation" description="Each run searches a different slice of your queries × countries per source and continues from the result page where the last run stopped, so runs keep finding new jobs instead of repeating the same first page.">
        <div className="grid gap-3 sm:grid-cols-2">
          <SwitchRow label="Rotate searches" help="Off = every run uses the first combinations in priority order (the old behaviour)." checked={v.rotation.enabled} onCheckedChange={(c) => set({ rotation: { ...v.rotation, enabled: c } })} />
          <SwitchRow label="Query variants from the profile" help="Adds your target titles (and, for developers, main skills such as “Python developer”) to the query list." checked={v.rotation.autoVariants} onCheckedChange={(c) => set({ rotation: { ...v.rotation, autoVariants: c } })} />
          <Field label="Combinations per source per run" htmlFor="rot-combos" help="Higher covers more per run but uses more requests and quota.">
            <NumberInput id="rot-combos" integer min={1} max={40} value={v.rotation.combosPerSource} onValueChange={(n) => set({ rotation: { ...v.rotation, combosPerSource: n } })} />
          </Field>
          <Field label="Rest days after a full sweep" htmlFor="rot-cycle" help="A combination whose last page was reached waits this long before starting again from page 1.">
            <NumberInput id="rot-cycle" integer min={1} max={30} value={v.rotation.cycleDays} onValueChange={(n) => set({ rotation: { ...v.rotation, cycleDays: n } })} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Light board runs" description="Between the full searches, a short run reads only the company ATS boards and the visa-flagged feeds, so new postings are seen within hours of going live.">
        <Field label="Minutes between light runs" htmlFor="boards-every" help="0 = off. Full searches keep their own interval (Settings → General).">
          <NumberInput id="boards-every" integer min={0} max={1440} value={v.boardsRunEveryMinutes ?? 0} onValueChange={(n) => set({ boardsRunEveryMinutes: n })} className="max-w-40" />
        </Field>
      </SectionCard>

      <SectionCard title="Sources" description="Turn job boards on or off and cap how many pages each one fetches per combination.">
        <p className="mb-3 text-xs text-muted-foreground">
          A pages cap of 3 means each run fetches at most 3 result pages of a combination; with rotation on, the next run continues from page 4. Sources marked “Needs …” switch on automatically once the key is in the environment.
        </p>
        <div className="divide-y rounded-lg border">
          {SOURCE_IDS.map((id) => {
            const src = v.sources[id]
            // A source added in code before its settings default exists: nothing to edit yet.
            if (!src) return null
            const label = SOURCE_LABELS[id] ?? id
            return (
              <div key={id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Switch checked={src.enabled} onCheckedChange={(c) => updateSource(id, { enabled: c })} aria-label={`Enable ${label}`} className="mt-0.5" />
                  <div className="min-w-0">
                    <p className={cn('text-sm font-medium', !src.enabled && 'text-muted-foreground')}>{label}</p>
                    <p className="text-xs text-muted-foreground">{sourceHelp(id).text}</p>
                    {sourceHelp(id).warning ? <p className="mt-1 rounded-md bg-warning-soft px-2 py-1 text-xs text-warning-text">{sourceHelp(id).warning}</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 pl-11 sm:pl-0">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Pages
                    <NumberInput className="w-20" integer min={1} max={id === 'jsearch' ? 5 : 20} value={src.maxPages} onValueChange={(n) => updateSource(id, { maxPages: n })} disabled={!src.enabled} aria-label={`${label} max pages`} />
                  </label>
                  {id === 'jsearch' ? (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Daily budget
                      <NumberInput className="w-20" integer min={0} max={50} value={v.sources.jsearch.dailyBudget} onValueChange={(n) => updateSource('jsearch', { dailyBudget: n })} disabled={!src.enabled} aria-label="JSearch daily request budget" />
                    </label>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
        <Hint>
          API keys live in the environment, not here: <code className="font-mono">JOOBLE_KEY</code> for Jooble, <code className="font-mono">ADZUNA_APP_ID</code> / <code className="font-mono">ADZUNA_APP_KEY</code> for Adzuna and{' '}
          <code className="font-mono">RAPIDAPI_KEY</code> for JSearch (~200 free requests a month). Company ATS boards use the Companies list; Arbeitnow and Remotive need nothing. Browser scraping needs
          Chromium on the worker.
        </Hint>
      </SectionCard>

      <SectionCard title="Deep fetch" description="Open short listings from snippet-only sources (Jooble, Adzuna) in the browser to read the full posting and any email address.">
        <SwitchRow label="Deep fetch short listings" help="Slower per job, but finds contact emails and full descriptions the APIs leave out." checked={v.deepFetch} onCheckedChange={(c) => set({ deepFetch: c })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Max listings per run" htmlFor="deep-fetch-limit" help="0–300. Caps browser visits per search run.">
            <NumberInput id="deep-fetch-limit" integer min={0} max={300} value={v.deepFetchLimit} onValueChange={(n) => set({ deepFetchLimit: n })} disabled={!v.deepFetch} />
          </Field>
          <Field label="Only when shorter than (characters)" htmlFor="deep-fetch-min" help="100–5000. Listings with at least this much text are not re-fetched.">
            <NumberInput id="deep-fetch-min" integer min={100} max={5000} value={v.deepFetchMinChars} onValueChange={(n) => set({ deepFetchMinChars: n })} disabled={!v.deepFetch} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Contact discovery" description="For high-scoring jobs without an application email: look on the company website, then search the web (Gemini with Google Search, plus Google Programmable Search if GOOGLE_CSE_KEY/GOOGLE_CSE_CX are set), then guess careers@ / jobs@ … on the company domain when it accepts mail.">
        <SwitchRow label="Find contact addresses" help="Guessed addresses are marked as such and only auto-sent when allowed in Settings → Email. A bounce rotates to the next guess, up to 10." checked={v.contactDiscovery} onCheckedChange={(c) => set({ contactDiscovery: c })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Max jobs per run" htmlFor="contact-limit" help="0–300. Only jobs above the draft threshold are checked.">
            <NumberInput id="contact-limit" integer min={0} max={300} value={v.contactDiscoveryLimit} onValueChange={(n) => set({ contactDiscoveryLimit: n })} disabled={!v.contactDiscovery} />
          </Field>
        </div>
      </SectionCard>

      <SaveBar dirty={form.dirty} saving={form.saving} onSave={form.save} onDiscard={form.discard} error={form.saveError} />
    </div>
  )
}
