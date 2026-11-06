'use client'

import { RotateCcw } from 'lucide-react'
import { DEFAULT_RANKING, type RankingWeights } from '@/lib/settings/schema'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Field, Hint, NumberInput, SectionCard } from './fields'
import { SaveBar, SettingsError, SettingsLoading, useSettingsSection } from './settings-form'
import { TagInput } from './tag-input'

const WEIGHT_META: Record<keyof RankingWeights, { label: string; description: string }> = {
  sponsorshipYes: { label: 'Sponsorship: yes', description: 'Sponsorship explicitly offered in the posting. Counts only where you need a visa (0 when you never do).' },
  sponsorshipLikely: { label: 'Sponsorship: likely', description: 'Wording that suggests sponsorship (relocation, international hires). Counts only where you need a visa.' },
  countryTier1: { label: 'Country tier 1', description: 'Job is in a tier-1 priority country.' },
  countryTier2: { label: 'Country tier 2', description: 'Job is in a tier-2 priority country.' },
  countryTier3: { label: 'Country tier 3', description: 'Job is in a tier-3 priority country.' },
  countryOtherEu: { label: 'Other EU/EEA', description: 'European country not in any tier.' },
  countryUk: { label: 'United Kingdom', description: 'Job is in the UK.' },
  countryOutsideEurope: { label: 'Outside Europe', description: 'Job is in a country outside Europe you switched on (if you need a visa there, only postings that state sponsorship get this far).' },
  remoteEu: { label: 'Remote (Europe)', description: 'Remote role open to Europe.' },
  titleMatch: { label: 'Title match', description: 'Title matches one of your target titles.' },
  titleExact: { label: 'Exact target title', description: 'The job title is one of your target titles, levels aside (e.g. "Product Designer II" for "Product Designer").' },
  titleNotSoftware: { label: 'Title outside your field', description: 'Penalty when the title has no words of your profession at all (e.g. procurement for a designer).' },
  senioritySeniorLead: { label: 'Level matches', description: 'The title names a level you look for (from your profile).' },
  seniorityStaff: { label: 'Level above yours', description: 'Staff, principal or manager title you did not pick.' },
  seniorityJunior: { label: 'Junior', description: 'Junior-level title when you did not pick junior.' },
  stackPerHit: { label: 'Skill keyword (each)', description: 'Per skill keyword found in the posting.' },
  stackMax: { label: 'Skill keyword cap', description: 'Maximum total points from skill keywords.' },
  languageRequired: { label: 'Language required', description: 'The posting requires a language you do not speak (from your profile; English when none are set).' },
  salaryGood: { label: 'Good salary', description: 'Salary at or above the “good salary” threshold.' },
  salaryBelowCsep: { label: 'Below CSEP', description: 'Irish jobs only, when you need a permit there: salary below the Critical Skills permit threshold.' },
  salaryBelowMin: { label: 'Below your minimum', description: 'Listed salary below your minimum salary.' },
  mustHaveMissing: { label: 'Missing must-have skill', description: 'Per must-have skill the profile does not list.' },
  mustHaveMissingMax: { label: 'Missing skills cap', description: 'The most the missing must-have skills can take off in total.' },
  relocation: { label: 'Relocation', description: 'Relocation support is mentioned.' },
  fresh: { label: 'Fresh posting', description: 'Posted within the “fresh days” window.' },
  stale: { label: 'Stale posting', description: 'Posted more than “stale days” ago.' },
  knownSponsor: { label: 'Known sponsor', description: 'Company is flagged as a known sponsor.' },
}

const WEIGHT_KEYS = Object.keys(WEIGHT_META) as Array<keyof RankingWeights>

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function RankingForm() {
  const form = useSettingsSection('ranking')

  if (form.isPending) return <SettingsLoading />
  if (form.isError || !form.value) return <SettingsError error={form.error} onRetry={() => void form.refetch()} />

  const v = form.value
  const set = form.set
  const rulesPct = Math.round((1 - v.llmWeight) * 100)
  const aiPct = 100 - rulesPct

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="How the score is computed"
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => form.replace({ ...DEFAULT_RANKING, stackKeywords: v.stackKeywords, minSalaryEur: v.minSalaryEur })}>
            <RotateCcw className="size-3.5" /> Reset to defaults
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          Every job gets a <strong className="text-foreground">rules score</strong> (starts at the base and adds or subtracts the weights below, clamped to 0–100) and an{' '}
          <strong className="text-foreground">AI fit score</strong> from Gemini. The final score blends them:{' '}
          <code className="rounded bg-muted px-1 font-mono text-xs">final = (1 − AI weight) × rules + AI weight × AI</code>. With the default AI weight of 0.4 that is 60% rules / 40% AI.
          Jobs above the draft threshold get an email drafted; above the auto-send threshold they can be sent automatically (if auto-send is on).
        </p>
        <Hint>“Reset to defaults” only changes this form (your skill keywords and minimum salary stay) — nothing is saved until you press Save.</Hint>
      </SectionCard>

      <SectionCard title="Blend and base" description="Where the score starts and how much the AI opinion counts.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Base score" htmlFor="base" help="Starting point before any weights apply.">
            <NumberInput id="base" value={v.base} onValueChange={(n) => set({ base: n })} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="llm-weight">AI weight</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {v.llmWeight.toFixed(2)} · rules {rulesPct}% / AI {aiPct}%
              </span>
            </div>
            <div className="px-1 py-2">
              <Slider
                id="llm-weight"
                aria-label="AI weight"
                value={[v.llmWeight]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(val: number | readonly number[]) => set({ llmWeight: round2(typeof val === 'number' ? val : (val[0] ?? 0)) })}
              />
            </div>
            <p className="text-xs text-muted-foreground">0 = rules only, 1 = AI only.</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Weights" description="Points added (or subtracted, when negative) to the rules score when a condition matches.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WEIGHT_KEYS.map((key) => (
            <Field key={key} label={WEIGHT_META[key].label} htmlFor={`weight-${key}`} help={WEIGHT_META[key].description}>
              <NumberInput id={`weight-${key}`} value={v.weights[key]} onValueChange={(n) => set({ weights: { ...v.weights, [key]: n } })} />
            </Field>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Thresholds" description="Salary and freshness cut-offs used by the weights above, and when to draft or auto-send.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Minimum salary (EUR a year)" htmlFor="min-salary" help="Listed salaries below this lose points. Empty = no minimum.">
            <NumberInput id="min-salary" integer min={0} value={v.minSalaryEur ?? 0} onValueChange={(n) => set({ minSalaryEur: n > 0 ? n : null })} />
          </Field>
          <Field label="CSEP threshold (EUR)" htmlFor="csep" help="Irish Critical Skills permit floor: applies only when you need a permit in Ireland.">
            <NumberInput id="csep" integer min={0} value={v.csepThresholdEur} onValueChange={(n) => set({ csepThresholdEur: n })} />
          </Field>
          <Field label="Good salary (EUR)" htmlFor="good-salary" help="At or above this earns the “good salary” points.">
            <NumberInput id="good-salary" integer min={0} value={v.goodSalaryEur} onValueChange={(n) => set({ goodSalaryEur: n })} />
          </Field>
          <Field label="Fresh (days)" htmlFor="fresh-days" help="Postings newer than this count as fresh.">
            <NumberInput id="fresh-days" integer min={0} value={v.freshDays} onValueChange={(n) => set({ freshDays: n })} />
          </Field>
          <Field label="Stale (days)" htmlFor="stale-days" help="Postings older than this count as stale.">
            <NumberInput id="stale-days" integer min={0} value={v.staleDays} onValueChange={(n) => set({ staleDays: n })} />
          </Field>
          <Field label="Draft threshold" htmlFor="draft-threshold" help="Draft an email when the final score is at least this (0–100).">
            <NumberInput id="draft-threshold" integer min={0} max={100} value={v.draftThreshold} onValueChange={(n) => set({ draftThreshold: n })} />
          </Field>
          <Field label="Auto-send threshold" htmlFor="auto-send-threshold" help="Auto-send (when enabled) needs at least this score (0–100).">
            <NumberInput id="auto-send-threshold" integer min={0} max={100} value={v.autoSendThreshold} onValueChange={(n) => set({ autoSendThreshold: n })} />
          </Field>
          <Field label="Max drafts per run" htmlFor="max-drafts" help="Caps AI drafting work per search run (0–200).">
            <NumberInput id="max-drafts" integer min={0} max={200} value={v.maxDraftsPerRun} onValueChange={(n) => set({ maxDraftsPerRun: n })} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Skill keywords" description="Each keyword found in a job posting adds the per-hit weight, up to the cap. Onboarding fills these from your profile's skills.">
        <Field label="Keywords" htmlFor="stack-keywords">
          <TagInput id="stack-keywords" value={v.stackKeywords} onChange={(stackKeywords) => set({ stackKeywords })} placeholder="e.g. figma" normalize={(s) => s.toLowerCase()} />
        </Field>
      </SectionCard>

      <SaveBar dirty={form.dirty} saving={form.saving} onSave={form.save} onDiscard={form.discard} error={form.saveError} />
    </div>
  )
}
