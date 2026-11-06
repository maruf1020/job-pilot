'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ATS_TYPES } from '@/lib/domain'
import { titleCase } from '@/lib/format'
import type { CompanyFormValues } from './types'

const NO_ATS = '__none'
const ATS_ITEMS = [{ value: NO_ATS, label: 'No ATS board' }, ...ATS_TYPES.map((t) => ({ value: t, label: titleCase(t) }))]

interface Props {
  values: CompanyFormValues
  onChange: (patch: Partial<CompanyFormValues>) => void
  disabled?: boolean
  /** Prefix for input ids so two forms can coexist on a page. */
  idPrefix?: string
  /** Hide the blacklist switch (e.g. on create). */
  showBlacklist?: boolean
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** The shared field set for creating and editing a company. */
export function CompanyFormFields({ values, onChange, disabled, idPrefix = 'company', showBlacklist = true }: Props) {
  const id = (f: string) => `${idPrefix}-${f}`
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field id={id('name')} label="Name">
        <Input id={id('name')} value={values.name} onChange={(e) => onChange({ name: e.target.value })} disabled={disabled} required maxLength={200} placeholder="Acme GmbH" />
      </Field>
      <Field id={id('domain')} label="Domain">
        <Input id={id('domain')} value={values.domain} onChange={(e) => onChange({ domain: e.target.value })} disabled={disabled} maxLength={200} placeholder="acme.com" />
      </Field>
      <Field id={id('country')} label="Country" hint="ISO code, e.g. DE, NL, IE">
        <Input
          id={id('country')}
          value={values.countryCode}
          onChange={(e) => onChange({ countryCode: e.target.value.toUpperCase().slice(0, 2) })}
          disabled={disabled}
          maxLength={2}
          placeholder="DE"
          className="uppercase"
        />
      </Field>
      <Field id={id('ats')} label="ATS">
        <Select value={values.atsType || NO_ATS} onValueChange={(v) => onChange({ atsType: v === NO_ATS ? '' : String(v ?? '') })} items={ATS_ITEMS} disabled={disabled}>
          <SelectTrigger id={id('ats')} className="w-full" aria-label="ATS type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ATS_ITEMS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id={id('slug')} label="ATS slug" hint="The board identifier in the ATS URL, e.g. boards.greenhouse.io/<slug>">
        <Input id={id('slug')} value={values.atsSlug} onChange={(e) => onChange({ atsSlug: e.target.value })} disabled={disabled} maxLength={200} placeholder="acme" />
      </Field>
      <Field id={id('careers')} label="Careers URL">
        <Input id={id('careers')} type="url" value={values.careersUrl} onChange={(e) => onChange({ careersUrl: e.target.value })} disabled={disabled} placeholder="https://acme.com/careers" />
      </Field>
      <Field id={id('email')} label="Contact email" hint="Fallback recipient when a posting has no address">
        <Input id={id('email')} type="email" value={values.contactEmail} onChange={(e) => onChange({ contactEmail: e.target.value })} disabled={disabled} placeholder="jobs@acme.com" />
      </Field>
      <div className="flex flex-col gap-3 sm:pt-6">
        <label className="flex items-center justify-between gap-3 text-sm sm:justify-start">
          <span className="font-medium">Known visa sponsor</span>
          <Switch checked={values.knownSponsor} onCheckedChange={(c) => onChange({ knownSponsor: c })} disabled={disabled} aria-label="Known sponsor" />
        </label>
        {showBlacklist ? (
          <label className="flex items-center justify-between gap-3 text-sm sm:justify-start">
            <span className="font-medium">Blacklisted</span>
            <Switch checked={values.blacklisted} onCheckedChange={(c) => onChange({ blacklisted: c })} disabled={disabled} aria-label="Blacklisted" />
          </label>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <Field id={id('notes')} label="Notes">
          <Textarea id={id('notes')} value={values.notes} onChange={(e) => onChange({ notes: e.target.value })} disabled={disabled} maxLength={5000} rows={3} placeholder="Anything worth remembering about this company" />
        </Field>
      </div>
    </div>
  )
}
