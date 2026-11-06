'use client'

import { useRef, useState } from 'react'
import { ChevronDown, ImageUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/hooks'
import { FREE_MOVEMENT, PROFESSIONS, type Profession } from '@/lib/candidate/context'
import { EUROPE_COUNTRIES } from '@/lib/domain'
import { flagEmoji } from '@/lib/format'
import { OUTSIDE_EUROPE_NAMES, OUTSIDE_EUROPE_TARGETS } from '@/lib/regions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, Hint, NumberInput, SectionCard, SwitchRow } from '@/components/settings/fields'
import { TagInput } from '@/components/settings/tag-input'
import type { EducationDraft, ExperienceDraft, ProfileDraft } from './draft'
import {
  CURRENCIES,
  DIVERSITY_TOPICS,
  LANGUAGE_LEVELS,
  LINK_FIELDS,
  PREFER_NOT,
  PRONOUN_OPTIONS,
  RELOCATION_OPTIONS,
  REMOTE_OPTIONS,
  SENIORITY_OPTIONS,
  TITLE_SUGGESTIONS,
  TONE_OPTIONS,
} from './model'
import { ChoiceGroup, CountryMultiSelect, CountrySelect, MultiChoice, OptionSelect, RequiredMark, TimezoneSelect } from './pickers'

/**
 * The profile form, one topic per section. The onboarding wizard shows one section per step;
 * Settings > Profile shows them all on one page. Every section edits the same ProfileDraft.
 */
export interface SectionProps {
  d: ProfileDraft
  set: (patch: Partial<ProfileDraft>) => void
}

function Req({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <RequiredMark />
    </>
  )
}

/** The listed currencies, plus the saved one when it is not in the list. */
function currencyItems(current: string) {
  return [...CURRENCIES, ...(current && !(CURRENCIES as readonly string[]).includes(current) ? [current] : [])].map((c) => ({ value: c, label: c }))
}

// ---------------------------------------------------------------------------
// 3. Who you are
// ---------------------------------------------------------------------------

export function WhoSection({ d, set, hasPhoto }: SectionProps & { hasPhoto?: boolean }) {
  const known = (PRONOUN_OPTIONS as readonly string[]).includes(d.pronouns)
  const [otherPronouns, setOtherPronouns] = useState(!known && d.pronouns !== '')
  const pronounChoice = otherPronouns ? 'other' : known ? d.pronouns : 'none'
  return (
    <>
      <SectionCard title="Your name" description="As it should appear on applications. Fields marked * are needed to finish.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={<Req>Full name</Req>} htmlFor="p-full-name" className="sm:col-span-2">
            <Input id="p-full-name" value={d.fullName} onChange={(e) => set({ fullName: e.target.value })} autoComplete="name" placeholder="Alex Rivera" maxLength={120} required />
          </Field>
          <Field label="Given (first) name" htmlFor="p-given" help="Left empty, it is taken from the full name.">
            <Input id="p-given" value={d.givenName} onChange={(e) => set({ givenName: e.target.value })} autoComplete="given-name" maxLength={80} />
          </Field>
          <Field label="Family (last) name" htmlFor="p-family">
            <Input id="p-family" value={d.familyName} onChange={(e) => set({ familyName: e.target.value })} autoComplete="family-name" maxLength={80} />
          </Field>
          <Field label="Preferred name" htmlFor="p-preferred" help="What people should call you, if different.">
            <Input id="p-preferred" value={d.preferredName} onChange={(e) => set({ preferredName: e.target.value })} autoComplete="nickname" maxLength={80} />
          </Field>
        </div>
        <ChoiceGroup
          legend="Pronouns"
          name="p-pronouns"
          value={pronounChoice}
          onChange={(v) => {
            if (v === 'other') {
              setOtherPronouns(true)
              if (known) set({ pronouns: '' })
            } else {
              setOtherPronouns(false)
              set({ pronouns: v === 'none' ? '' : v })
            }
          }}
          options={[...PRONOUN_OPTIONS.map((p) => ({ value: p, label: p })), { value: 'other', label: 'Other' }, { value: 'none', label: PREFER_NOT }]}
          help="Used for forms that ask, and to write about you correctly."
        />
        {otherPronouns ? (
          <Field label="Your pronouns" htmlFor="p-pronouns-other">
            <Input id="p-pronouns-other" value={d.pronouns} onChange={(e) => set({ pronouns: e.target.value })} maxLength={40} placeholder="e.g. xe/xem" />
          </Field>
        ) : null}
      </SectionCard>

      <SectionCard title="Contact" description="Employers reply to this email and call this number.">
        <Field label={<Req>Email</Req>} htmlFor="p-email">
          <Input id="p-email" type="email" value={d.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" placeholder="alex@example.com" maxLength={200} required />
        </Field>
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
          <Field label="Country code" htmlFor="p-phone-cc">
            <Input id="p-phone-cc" value={d.phoneCountryCode} onChange={(e) => set({ phoneCountryCode: e.target.value })} inputMode="tel" placeholder="+351" maxLength={6} autoComplete="tel-country-code" />
          </Field>
          <Field label="Phone number" htmlFor="p-phone">
            <Input id="p-phone" type="tel" value={d.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="912 345 678" maxLength={40} autoComplete="tel-national" />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Links" description="Only the ones you have. Forms with a matching field get them.">
        <div className="grid gap-4 sm:grid-cols-2">
          {LINK_FIELDS.map((l) => (
            <Field key={l.key} label={l.label} htmlFor={`p-link-${l.key}`}>
              <Input id={`p-link-${l.key}`} type="url" inputMode="url" value={d.links[l.key]} onChange={(e) => set({ links: { ...d.links, [l.key]: e.target.value } })} placeholder={l.placeholder} maxLength={300} spellCheck={false} />
            </Field>
          ))}
        </div>
      </SectionCard>

      <PhotoCard initial={hasPhoto ?? false} />
    </>
  )
}

function PhotoCard({ initial }: { initial: boolean }) {
  const [has, setHas] = useState(initial)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error('The photo is larger than 2 MB')
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file, file.name)
      await api.post('/api/profile/photo', fd)
      setHas(true)
      setVersion((v) => v + 1)
      toast.success('Photo saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the photo')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await api.delete('/api/profile/photo')
      setHas(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the photo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard title="Photo (optional)" description="Only for the few forms that require one. A JPG or PNG up to 2 MB, stored in this install's storage folder.">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
          {has ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private API image, not a static asset
            <img src={`/api/profile/photo?v=${version}`} alt="Your profile photo" className="size-full object-cover" />
          ) : (
            <ImageUp className="size-6 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={inputRef} id="p-photo" type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} disabled={busy} />
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImageUp className="size-3.5" />}
            {has ? 'Replace photo' : 'Upload photo'}
          </Button>
          {has ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
              <Trash2 className="size-3.5" /> Remove
            </Button>
          ) : null}
        </div>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// 4. Where you live and can work
// ---------------------------------------------------------------------------

export function WhereSection({ d, set }: SectionProps) {
  const euCitizen = d.citizenships.some((c) => FREE_MOVEMENT.has(c))
  return (
    <>
      <SectionCard title="Where you live" description="For address fields and the location line on applications.">
        <Field label="Street address" htmlFor="p-address" help="Optional. Only forms that require a full address get it.">
          <Input id="p-address" value={d.addressLine} onChange={(e) => set({ addressLine: e.target.value })} autoComplete="street-address" placeholder="Rua Exemplo 12" maxLength={200} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Postal code" htmlFor="p-postal">
            <Input id="p-postal" value={d.postalCode} onChange={(e) => set({ postalCode: e.target.value })} autoComplete="postal-code" placeholder="1000-001" maxLength={20} />
          </Field>
          <Field label="City" htmlFor="p-city">
            <Input id="p-city" value={d.city} onChange={(e) => set({ city: e.target.value })} autoComplete="address-level2" placeholder="Lisbon" maxLength={80} />
          </Field>
          <Field label="Region or state" htmlFor="p-region">
            <Input id="p-region" value={d.region} onChange={(e) => set({ region: e.target.value })} autoComplete="address-level1" maxLength={80} />
          </Field>
          <Field label={<Req>Country</Req>} htmlFor="p-country">
            <CountrySelect id="p-country" value={d.country} onChange={(country) => set({ country })} />
          </Field>
          <Field label="Time zone" htmlFor="p-timezone" help="Preset from this browser. Used for interview times and when emails go out." className="sm:col-span-2">
            <TimezoneSelect id="p-timezone" value={d.timezone} onChange={(timezone) => set({ timezone })} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Right to work" description="Work-permit questions are answered from this, country by country, and never claim a permit you do not have.">
        <Field label="Citizenship" htmlFor="p-citizenships" help="Every country whose passport you hold.">
          <CountryMultiSelect id="p-citizenships" value={d.citizenships} onChange={(citizenships) => set({ citizenships })} max={10} />
        </Field>
        {euCitizen ? <Hint>As a citizen of an EU/EEA country or Switzerland you may already work in all of them without a visa.</Hint> : null}
        <ChoiceGroup
          legend="Do you need visa sponsorship to work in countries where you are not a citizen?"
          name="p-sponsorship"
          required
          value={d.needsSponsorship === null ? '' : d.needsSponsorship ? 'yes' : 'no'}
          onChange={(v) => set({ needsSponsorship: v === 'yes' })}
          options={[
            { value: 'yes', label: 'Yes, I need sponsorship' },
            { value: 'no', label: 'No' },
          ]}
          help="Answer for countries outside your citizenship and the list below."
        />
        <Field label="Other countries where you already have the right to work" htmlFor="p-rtw" help="For example a residence permit or a settled status. Leave empty if none.">
          <CountryMultiSelect id="p-rtw" value={d.rightToWork} onChange={(rightToWork) => set({ rightToWork })} />
        </Field>
        <Field label="Your work-authorisation sentence (optional)" htmlFor="p-auth-text" help="Used word for word when a form asks you to describe your work authorisation.">
          <Textarea
            id="p-auth-text"
            value={d.authorizationText}
            onChange={(e) => set({ authorizationText: e.target.value })}
            maxLength={600}
            rows={2}
            placeholder="e.g. Portuguese citizen with the right to work anywhere in the EU."
          />
        </Field>
      </SectionCard>

      <SectionCard title="Moving and remote work">
        <ChoiceGroup legend="Would you relocate for a job?" name="p-relocation" value={d.relocation} onChange={(relocation) => set({ relocation })} options={RELOCATION_OPTIONS} />
        <ChoiceGroup legend="Where do you want to work?" name="p-remote" value={d.remote} onChange={(remote) => set({ remote, prefs: { ...d.prefs, remoteOnly: remote === 'only' } })} options={REMOTE_OPTIONS} />
      </SectionCard>
    </>
  )
}

// ---------------------------------------------------------------------------
// 5. What you want
// ---------------------------------------------------------------------------

export function WantSection({ d, set }: SectionProps) {
  const suggestions = TITLE_SUGGESTIONS[d.profession].filter((t) => !d.titles.some((x) => x.toLowerCase() === t.toLowerCase()))
  return (
    <>
      <SectionCard title="Your field" description="Decides which jobs are searched and which ranking rules apply.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={<Req>Profession</Req>} htmlFor="p-profession">
            <OptionSelect id="p-profession" value={d.profession} onChange={(v) => set({ profession: v as Profession })} options={PROFESSIONS.map((p) => ({ value: p.id, label: p.label }))} />
          </Field>
          {d.profession === 'other' ? (
            <Field label="Your field" htmlFor="p-field" help="In a few words, e.g. Architecture or Nursing.">
              <Input id="p-field" value={d.field} onChange={(e) => set({ field: e.target.value })} maxLength={80} />
            </Field>
          ) : null}
          <Field label="Headline" htmlFor="p-headline" help="One line that sums you up." className="sm:col-span-2">
            <Input id="p-headline" value={d.headline} onChange={(e) => set({ headline: e.target.value })} maxLength={160} placeholder="e.g. Product designer with 6 years in fintech" />
          </Field>
          <Field label="Years of experience" htmlFor="p-years">
            <NumberInput id="p-years" min={0} max={60} step={0.5} value={d.yearsExperience} onValueChange={(n) => set({ yearsExperience: Math.min(60, Math.max(0, n)) })} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Target roles" description="Job titles you want. Searches are built from them and a title match ranks a job higher.">
        <Field label={<Req>Target job titles</Req>} htmlFor="p-titles" help="Press Enter after each title. Up to 20.">
          <TagInput id="p-titles" value={d.titles} onChange={(titles) => set({ titles: titles.slice(0, 20) })} placeholder={TITLE_SUGGESTIONS[d.profession][0] ? `e.g. ${TITLE_SUGGESTIONS[d.profession][0]}` : 'e.g. Project Lead'} />
        </Field>
        {suggestions.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Suggestions:</span>
            {suggestions.map((t) => (
              <Button key={t} type="button" variant="outline" size="xs" onClick={() => set({ titles: [...d.titles, t].slice(0, 20) })}>
                <Plus className="size-3" /> {t}
              </Button>
            ))}
          </div>
        ) : null}
        <MultiChoice legend="Seniority" help="Every level you would accept." value={d.seniority} onChange={(seniority) => set({ seniority })} options={SENIORITY_OPTIONS} />
      </SectionCard>

      <SectionCard title="Skills" description="What applications may claim, and what they must never claim.">
        <Field label="Skills" htmlFor="p-skills" help="Things you could talk about in an interview. Up to 60.">
          <TagInput id="p-skills" value={d.skills} onChange={(skills) => set({ skills: skills.slice(0, 60) })} placeholder="e.g. Figma, SQL, TypeScript" />
        </Field>
        <Field label="Skills never to claim" htmlFor="p-stop-skills" help="Even when a job asks for them. Up to 60.">
          <TagInput id="p-stop-skills" value={d.stopSkills} onChange={(stopSkills) => set({ stopSkills: stopSkills.slice(0, 60) })} placeholder="e.g. Kubernetes" />
        </Field>
        <Field label="Summary" htmlFor="p-summary" help="Two or three sentences about you that applications can draw on. Max 2000 characters.">
          <Textarea id="p-summary" value={d.summary} onChange={(e) => set({ summary: e.target.value })} maxLength={2000} rows={4} />
        </Field>
      </SectionCard>
    </>
  )
}

// ---------------------------------------------------------------------------
// 6. Where to look
// ---------------------------------------------------------------------------

const EUROPE_LIST = Object.entries(EUROPE_COUNTRIES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name))
const OUTSIDE_LIST = OUTSIDE_EUROPE_TARGETS.map((code) => ({ code, name: OUTSIDE_EUROPE_NAMES[code] })).sort((a, b) => a.name.localeCompare(b.name))
const ALL_LIST = [...EUROPE_LIST, ...OUTSIDE_LIST]

function CountryGrid({ list, selected, onToggle, label, help }: { list: Array<{ code: string; name: string }>; selected: string[]; onToggle: (code: string, on: boolean) => void; label: string; help?: string }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">{label}</legend>
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      <div className="grid grid-cols-1 gap-0.5 min-[400px]:grid-cols-2 sm:grid-cols-3">
        {list.map(({ code, name }) => {
          const checked = selected.includes(code)
          return (
            <label key={code} className={cn('flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted', checked && 'bg-muted/60')}>
              <Checkbox checked={checked} onCheckedChange={(c) => onToggle(code, c)} aria-label={name} />
              <span aria-hidden className="text-base leading-none">
                {flagEmoji(code)}
              </span>
              <span className="min-w-0 truncate">{name}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function LookSection({ d, set, showSearch = true }: SectionProps & { showSearch?: boolean }) {
  const p = d.prefs
  const setPrefs = (patch: Partial<ProfileDraft['prefs']>) => set({ prefs: { ...p, ...patch } })
  const toggleCountry = (code: string, on: boolean) => {
    const countries = on ? [...p.countries, code] : p.countries.filter((c) => c !== code)
    setPrefs({ countries, firstChoice: p.firstChoice.filter((c) => countries.includes(c)) })
  }
  return (
    <>
      {showSearch ? (
        <SectionCard
          title={<Req>Countries to search</Req>}
          description="Jobs are searched in these countries. Countries where you would need a visa only get jobs that mention sponsorship."
          action={
            <div className="flex gap-1">
              <Button type="button" size="xs" variant="ghost" onClick={() => setPrefs({ countries: [...new Set([...p.countries, ...EUROPE_LIST.map((c) => c.code)])] })}>
                All of Europe
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setPrefs({ countries: [], firstChoice: [] })}>
                Clear
              </Button>
            </div>
          }
        >
          <CountryGrid list={EUROPE_LIST} selected={p.countries} onToggle={toggleCountry} label="Europe" />
          <CountryGrid list={OUTSIDE_LIST} selected={p.countries} onToggle={toggleCountry} label="Outside Europe" help="Only jobs that state visa sponsorship get through there, unless you may already work in that country." />
          <p className="text-xs text-muted-foreground">{p.countries.length ? `${p.countries.length} selected.` : 'Pick at least one country.'}</p>
          {p.countries.length > 1 ? (
            <MultiChoice
              legend="First choice (optional)"
              help="Jobs in these countries rank above the others. Leave empty to treat all the same."
              value={p.firstChoice}
              onChange={(firstChoice) => setPrefs({ firstChoice })}
              options={ALL_LIST.filter((c) => p.countries.includes(c.code)).map((c) => ({ value: c.code, label: `${flagEmoji(c.code)} ${c.name}` }))}
            />
          ) : null}
        </SectionCard>
      ) : null}

      {showSearch ? (
        <SectionCard title="Remote work and salary">
          <div className="grid gap-3 sm:grid-cols-2">
            <SwitchRow label="Include remote roles" help="Keep remote jobs open to people in your region." checked={p.includeRemote || p.remoteOnly} disabled={p.remoteOnly} onCheckedChange={(includeRemote) => setPrefs({ includeRemote })} />
            <SwitchRow
              label="Remote only"
              help="Skip jobs that need you in an office."
              checked={p.remoteOnly}
              onCheckedChange={(remoteOnly) => set({ prefs: { ...p, remoteOnly, includeRemote: remoteOnly || p.includeRemote }, remote: remoteOnly ? 'only' : d.remote === 'only' ? 'ok' : d.remote })}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3 sm:max-w-md">
            <Field label="Minimum yearly salary (optional)" htmlFor="p-min-salary" help="Jobs that state less rank lower.">
              <Input
                id="p-min-salary"
                type="number"
                inputMode="numeric"
                min={0}
                step={1000}
                value={p.minSalary ?? ''}
                onChange={(e) => {
                  const n = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)))
                  setPrefs({ minSalary: n !== null && Number.isFinite(n) ? n : null })
                }}
                placeholder="e.g. 45000"
                className="tabular-nums"
              />
            </Field>
            <Field label="Currency" htmlFor="p-currency">
              <OptionSelect id="p-currency" value={d.salaryCurrency} onChange={(salaryCurrency) => set({ salaryCurrency })} options={currencyItems(d.salaryCurrency)} />
            </Field>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Languages" description="Languages you speak and how well. Forms and language requirements are matched against this.">
        <LanguageList d={d} set={set} />
      </SectionCard>
    </>
  )
}

function LanguageList({ d, set }: SectionProps) {
  const list = d.languageLevels
  const update = (i: number, patch: Partial<{ name: string; level: string }>) => set({ languageLevels: list.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  return (
    <div className="flex flex-col gap-2">
      {list.length === 0 ? <p className="text-sm text-muted-foreground">No languages yet.</p> : null}
      {list.map((l, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)_auto] items-end gap-2">
          <Field label="Language" htmlFor={`p-lang-${i}`}>
            <Input id={`p-lang-${i}`} value={l.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. English" maxLength={40} />
          </Field>
          <Field label="Level" htmlFor={`p-lang-level-${i}`}>
            <OptionSelect id={`p-lang-level-${i}`} value={l.level} onChange={(level) => update(i, { level })} options={LANGUAGE_LEVELS} />
          </Field>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${l.name || 'this language'}`} onClick={() => set({ languageLevels: list.filter((_, j) => j !== i) })}>
            <Trash2 className="size-4 text-muted-foreground" />
          </Button>
        </div>
      ))}
      {list.length < 10 ? (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => set({ languageLevels: [...list, { name: '', level: list.length ? 'professional' : 'native' }] })}>
          <Plus className="size-3.5" /> Add a language
        </Button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 7. Experience and education
// ---------------------------------------------------------------------------

const EMPTY_JOB: ExperienceDraft = { company: '', title: '', from: '', to: '', bullets: '' }
const EMPTY_SCHOOL: EducationDraft = { school: '', degree: '', year: '' }

export function ExperienceSection({ d, set }: SectionProps) {
  const jobs = d.experience
  const schools = d.education
  const updateJob = (i: number, patch: Partial<ExperienceDraft>) => set({ experience: jobs.map((j, k) => (k === i ? { ...j, ...patch } : j)) })
  const updateSchool = (i: number, patch: Partial<EducationDraft>) => set({ education: schools.map((s, k) => (k === i ? { ...s, ...patch } : s)) })
  return (
    <>
      <SectionCard
        title="Work experience"
        description="Most recent first. Former-employer questions and cover letters use this."
        action={
          jobs.length < 20 ? (
            <Button type="button" size="sm" variant="outline" onClick={() => set({ experience: [...jobs, EMPTY_JOB] })}>
              <Plus className="size-3.5" /> Add a job
            </Button>
          ) : null
        }
      >
        {jobs.length === 0 ? <p className="text-sm text-muted-foreground">No jobs yet. Add them here, or upload your CV to fill this in.</p> : null}
        {jobs.map((j, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-lg border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium">{[j.title, j.company].filter(Boolean).join(' at ') || `Job ${i + 1}`}</p>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove job ${i + 1}`} onClick={() => set({ experience: jobs.filter((_, k) => k !== i) })}>
                <Trash2 className="size-4 text-muted-foreground" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company" htmlFor={`p-job-company-${i}`}>
                <Input id={`p-job-company-${i}`} value={j.company} onChange={(e) => updateJob(i, { company: e.target.value })} placeholder="Northwind Labs" maxLength={120} />
              </Field>
              <Field label="Job title" htmlFor={`p-job-title-${i}`}>
                <Input id={`p-job-title-${i}`} value={j.title} onChange={(e) => updateJob(i, { title: e.target.value })} maxLength={120} />
              </Field>
              <Field label="From" htmlFor={`p-job-from-${i}`} help="e.g. 2021-03">
                <Input id={`p-job-from-${i}`} value={j.from} onChange={(e) => updateJob(i, { from: e.target.value })} maxLength={20} />
              </Field>
              <Field label="To" htmlFor={`p-job-to-${i}`} help="Leave empty or write Present for your current job.">
                <Input id={`p-job-to-${i}`} value={j.to} onChange={(e) => updateJob(i, { to: e.target.value })} maxLength={20} />
              </Field>
            </div>
            <Field label="What you did" htmlFor={`p-job-bullets-${i}`} help="One point per line, with numbers where you have them.">
              <Textarea id={`p-job-bullets-${i}`} value={j.bullets} onChange={(e) => updateJob(i, { bullets: e.target.value })} rows={3} />
            </Field>
          </div>
        ))}
      </SectionCard>

      <SectionCard
        title="Education"
        action={
          schools.length < 10 ? (
            <Button type="button" size="sm" variant="outline" onClick={() => set({ education: [...schools, EMPTY_SCHOOL] })}>
              <Plus className="size-3.5" /> Add a school
            </Button>
          ) : null
        }
      >
        {schools.length === 0 ? <p className="text-sm text-muted-foreground">No education yet.</p> : null}
        {schools.map((s, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-lg border bg-background p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem]">
              <Field label="School" htmlFor={`p-school-${i}`}>
                <Input id={`p-school-${i}`} value={s.school} onChange={(e) => updateSchool(i, { school: e.target.value })} placeholder="University of Lisbon" maxLength={160} />
              </Field>
              <Field label="Degree" htmlFor={`p-school-degree-${i}`}>
                <Input id={`p-school-degree-${i}`} value={s.degree} onChange={(e) => updateSchool(i, { degree: e.target.value })} placeholder="BSc Computer Science" maxLength={160} />
              </Field>
              <Field label="Year" htmlFor={`p-school-year-${i}`}>
                <Input id={`p-school-year-${i}`} value={s.year} onChange={(e) => updateSchool(i, { year: e.target.value })} inputMode="numeric" placeholder="2018" maxLength={10} />
              </Field>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" className="mt-6" aria-label={`Remove school ${i + 1}`} onClick={() => set({ education: schools.filter((_, k) => k !== i) })}>
              <Trash2 className="size-4 text-muted-foreground" />
            </Button>
          </div>
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Highest degree" htmlFor="p-degree" help="As forms should get it, e.g. Bachelor's degree.">
            <Input id="p-degree" value={d.degree} onChange={(e) => set({ degree: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Grade or GPA (optional)" htmlFor="p-gpa" help="Only given when a form asks.">
            <Input id="p-gpa" value={d.gpa} onChange={(e) => set({ gpa: e.target.value })} maxLength={20} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Quotable facts" description="Short achievements with numbers. Applications may quote them; nothing else is invented.">
        <Field label="Facts" htmlFor="p-facts" help="Press Enter after each one. Up to 30.">
          <TagInput id="p-facts" value={d.facts} onChange={(facts) => set({ facts: facts.slice(0, 30) })} placeholder="e.g. Cut checkout time by 30% for 2 million users" />
        </Field>
      </SectionCard>
    </>
  )
}

// ---------------------------------------------------------------------------
// 8. Standard form answers
// ---------------------------------------------------------------------------

export function AnswersSection({ d, set }: SectionProps) {
  const answered = DIVERSITY_TOPICS.filter((t) => d.diversity[t.key]).length + (d.dateOfBirth ? 1 : 0)
  return (
    <>
      <SectionCard title="Availability" description="Only used when a form asks. Emails never mention them.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Notice period" htmlFor="p-notice">
            <Input id="p-notice" value={d.noticePeriod} onChange={(e) => set({ noticePeriod: e.target.value })} placeholder="e.g. 1 month" maxLength={120} />
          </Field>
          <Field label="Earliest start" htmlFor="p-start">
            <Input id="p-start" value={d.earliestStart} onChange={(e) => set({ earliestStart: e.target.value })} placeholder="e.g. 2 months after an offer" maxLength={120} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Salary">
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3 sm:max-w-md">
          <Field label="Expected salary" htmlFor="p-salary" help="Yearly, as you would write it on a form.">
            <Input id="p-salary" value={d.salaryExpectation} onChange={(e) => set({ salaryExpectation: e.target.value })} placeholder="e.g. 55000" maxLength={160} />
          </Field>
          <Field label="Currency" htmlFor="p-salary-currency">
            <OptionSelect id="p-salary-currency" value={d.salaryCurrency} onChange={(salaryCurrency) => set({ salaryCurrency })} options={currencyItems(d.salaryCurrency)} />
          </Field>
        </div>
        <SwitchRow
          label="Only give it when a form or email asks"
          help="On: the salary is never volunteered, only filled into a required field or a direct question."
          checked={d.salaryOnlyWhenAsked}
          onCheckedChange={(salaryOnlyWhenAsked) => set({ salaryOnlyWhenAsked })}
        />
      </SectionCard>

      <SectionCard title="Common questions">
        <Field label="How do you usually find jobs?" htmlFor="p-how-heard" help='For "How did you hear about us?" when nothing better is known.'>
          <Input id="p-how-heard" value={d.howHeard} onChange={(e) => set({ howHeard: e.target.value })} placeholder="e.g. LinkedIn, then company career pages" maxLength={300} />
        </Field>
        <Field label="Why are you looking?" htmlFor="p-motivation" help='For "Why are you leaving your current job?" Keep it positive.'>
          <Textarea id="p-motivation" value={d.motivation} onChange={(e) => set({ motivation: e.target.value })} maxLength={1000} rows={3} placeholder="e.g. I want to work on products used by more people and grow into a lead role." />
        </Field>
      </SectionCard>

      <Collapsible className="min-w-0 rounded-lg border bg-card shadow-[var(--shadow-card)]">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Diversity questions (optional)</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{answered ? `${answered} answered. The rest get "${PREFER_NOT}".` : `Every answer is "${PREFER_NOT}" until you change it.`}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-4 border-t p-4">
            <p className="text-xs text-muted-foreground">Many employers ask these for equal-opportunity monitoring. They never affect which jobs you get and are only filled into forms that ask.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {DIVERSITY_TOPICS.map((t) => (
                <Field key={t.key} label={t.label} htmlFor={`p-div-${t.key}`}>
                  <OptionSelect
                    id={`p-div-${t.key}`}
                    value={d.diversity[t.key]}
                    onChange={(v) => set({ diversity: { ...d.diversity, [t.key]: v } })}
                    emptyLabel={PREFER_NOT}
                    options={[...t.options, ...(d.diversity[t.key] && !t.options.includes(d.diversity[t.key]) ? [d.diversity[t.key]] : [])].map((o) => ({ value: o, label: o }))}
                  />
                </Field>
              ))}
              <Field label="Date of birth" htmlFor="p-dob" help="Leave empty unless forms you use require it.">
                <Input id="p-dob" type="date" value={d.dateOfBirth} onChange={(e) => set({ dateOfBirth: e.target.value })} max={new Date().toISOString().slice(0, 10)} />
              </Field>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}

// ---------------------------------------------------------------------------
// 9. Email voice
// ---------------------------------------------------------------------------

export function VoiceSection({ d, set }: SectionProps) {
  return (
    <>
      <SectionCard title="Tone" description="How application emails and cover letters sound.">
        <ChoiceGroup legend="Tone" name="p-tone" value={d.tone} onChange={(tone) => set({ tone })} options={TONE_OPTIONS} help={TONE_OPTIONS.find((t) => t.value === d.tone)?.help} />
        <Field label="Lead with" htmlFor="p-lead-with" help="Skills, products or results to mention first.">
          <TagInput id="p-lead-with" value={d.leadWith} onChange={(leadWith) => set({ leadWith: leadWith.slice(0, 30) })} placeholder="e.g. design systems" />
        </Field>
        <Field label="Never mention" htmlFor="p-never-mention" help="Topics that must never appear, e.g. an old specialism you are moving away from.">
          <TagInput id="p-never-mention" value={d.neverMention} onChange={(neverMention) => set({ neverMention: neverMention.slice(0, 30) })} placeholder="e.g. call-centre work" />
        </Field>
      </SectionCard>

      <SectionCard title="Sign-off">
        <Field label="Sign-off line" htmlFor="p-sign-off" help="The line before your name.">
          <Input id="p-sign-off" value={d.signOff} onChange={(e) => set({ signOff: e.target.value })} placeholder="Kind regards," maxLength={80} />
        </Field>
        <Field label="Signature block" htmlFor="p-signature" help="Added under every email. Plain text, max 600 characters.">
          <Textarea id="p-signature" value={d.signature} onChange={(e) => set({ signature: e.target.value })} maxLength={600} rows={4} className="font-mono text-xs" placeholder={'Alex Rivera\n+351 912 345 678\nlinkedin.com/in/alex-rivera'} />
        </Field>
        <Field label="Mindset (optional)" htmlFor="p-mindset" help="How you think about your work, in your own words. Emails use at most one humble sentence of it. Max 600 characters.">
          <Textarea id="p-mindset" value={d.mindset} onChange={(e) => set({ mindset: e.target.value })} maxLength={600} rows={3} placeholder="e.g. I like to understand the problem before choosing the tool, and I learn new tools quickly." />
        </Field>
      </SectionCard>
    </>
  )
}

/** Plain label for a value in the review summary. */
export function LabelValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-1.5 text-sm sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
      <span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
      <div className="min-w-0 wrap-break-word">{value === '' || value === null || value === undefined ? <span className="text-muted-foreground">Not given</span> : value}</div>
    </div>
  )
}
