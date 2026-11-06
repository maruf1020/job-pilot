'use client'

import type { AiConfig } from '@/lib/settings/schema'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { OptionSelect } from '@/components/onboarding/pickers'
import { Field, NumberInput, SectionCard, SwitchRow } from './fields'
import { SaveBar, SettingsError, SettingsLoading, useSettingsSection } from './settings-form'

const TONE_ITEMS: Array<{ value: AiConfig['tone']; label: string }> = [
  { value: 'warm', label: 'Warm' },
  { value: 'direct', label: 'Direct' },
  { value: 'formal', label: 'Formal' },
]

const RANK_ITEMS: Array<{ value: AiConfig['rankModel']; label: string }> = [
  { value: 'lite', label: 'Lite model (cheaper, keeps quota for writing)' },
  { value: 'primary', label: 'Primary model (more careful)' },
]

function isTone(v: string): v is AiConfig['tone'] {
  return v === 'direct' || v === 'warm' || v === 'formal'
}

/**
 * AI behaviour that does not depend on the provider. Models are chosen per key (AI keys above), so
 * nothing here names a provider or a model.
 */
export function AiForm() {
  const form = useSettingsSection('ai')

  if (form.isPending) return <SettingsLoading />
  if (form.isError || !form.value) return <SettingsError error={form.error} onRetry={() => void form.refetch()} />

  const v = form.value
  const set = form.set

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Drafting" description="How emails are written and checked before they reach review. Your email voice (Settings > Profile) comes on top of this.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default tone" htmlFor="tone">
            <OptionSelect id="tone" value={v.tone} onChange={(t) => isTone(t) && set({ tone: t })} options={TONE_ITEMS} />
          </Field>
          <Field label="Target length (words)" htmlFor="words-min">
            <div className="flex items-center gap-2">
              <NumberInput id="words-min" integer min={30} value={v.targetWords.min} onValueChange={(n) => set({ targetWords: { ...v.targetWords, min: n } })} aria-label="Minimum words" />
              <span className="text-xs text-muted-foreground">to</span>
              <NumberInput integer min={30} value={v.targetWords.max} onValueChange={(n) => set({ targetWords: { ...v.targetWords, max: n } })} aria-label="Maximum words" />
            </div>
          </Field>
          <Field label="Judge threshold" htmlFor="judge-threshold" help="0-100. Drafts that sound more machine-written than this are rewritten.">
            <NumberInput id="judge-threshold" integer min={0} max={100} value={v.judgeThreshold} onValueChange={(n) => set({ judgeThreshold: n })} />
          </Field>
          <Field label="Max rewrite rounds" htmlFor="rewrite-rounds" help="0-6. After this many rounds the draft goes to review, flagged.">
            <NumberInput id="rewrite-rounds" integer min={0} max={6} value={v.maxRewriteRounds} onValueChange={(n) => set({ maxRewriteRounds: n })} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Throughput" description="Batch sizes and parallel calls. Higher is faster but uses quota sooner.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Enrich batch size" htmlFor="enrich-batch" help="Jobs per enrichment call (1-25).">
            <NumberInput id="enrich-batch" integer min={1} max={25} value={v.enrichBatchSize} onValueChange={(n) => set({ enrichBatchSize: n })} />
          </Field>
          <Field label="Rank batch size" htmlFor="rank-batch" help="Jobs per ranking call (1-25).">
            <NumberInput id="rank-batch" integer min={1} max={25} value={v.rankBatchSize} onValueChange={(n) => set({ rankBatchSize: n })} />
          </Field>
          <Field label="Parallel calls" htmlFor="concurrency" help="AI calls at the same time (1-8).">
            <NumberInput id="concurrency" integer min={1} max={8} value={v.concurrency} onValueChange={(n) => set({ concurrency: n })} />
          </Field>
        </div>
        <Field label="Model used for ranking" htmlFor="rank-model" help="Each key has a primary and a lite model.">
          <OptionSelect id="rank-model" value={v.rankModel} onChange={(m) => (m === 'lite' || m === 'primary') && set({ rankModel: m })} options={RANK_ITEMS} className="sm:max-w-md" />
        </Field>
      </SectionCard>

      <SectionCard title="Sapling AI detector" description="Optional second opinion on how machine-written a draft sounds. Needs a Sapling key in Settings > Keys & services.">
        <SwitchRow label="Use Sapling" checked={v.saplingEnabled} onCheckedChange={(c) => set({ saplingEnabled: c })} />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="sapling-max">Max AI score</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{v.saplingMaxScore.toFixed(2)}</span>
          </div>
          <div className="px-1 py-2">
            <Slider
              id="sapling-max"
              aria-label="Sapling max AI score"
              value={[v.saplingMaxScore]}
              min={0}
              max={1}
              step={0.05}
              disabled={!v.saplingEnabled}
              onValueChange={(val: number | readonly number[]) => set({ saplingMaxScore: Math.round((typeof val === 'number' ? val : (val[0] ?? 0)) * 100) / 100 })}
            />
          </div>
          <p className="text-xs text-muted-foreground">Drafts scoring above this (0 = human, 1 = machine) are rewritten.</p>
        </div>
      </SectionCard>

      <SaveBar dirty={form.dirty} saving={form.saving} onSave={form.save} onDiscard={form.discard} error={form.saveError} />
    </div>
  )
}
