'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Loader2, LogOut, PartyPopper } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, useApiMutation, useApiQuery, type ApiEnvelope } from '@/lib/api/hooks'
import { logoutAction } from '@/lib/auth/actions'
import { LINK_LABELS, PROFESSIONS } from '@/lib/candidate/context'
import { cn } from '@/lib/utils'
import { LogoMark } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AiKeysCard } from '@/components/settings/ai-keys'
import { Hint, SectionCard } from '@/components/settings/fields'
import { ResumeCard } from '@/components/settings/resume-card'
import { useEditable } from '@/components/settings/settings-form'
import { countryLabel } from './countries'
import { toDraft, toInput, type ProfileDraft } from './draft'
import { DIVERSITY_TOPICS, LANGUAGE_LEVELS, missingForFinish, RELOCATION_OPTIONS, REMOTE_OPTIONS, SENIORITY_OPTIONS, STEP_COUNT, STEPS, stepDef, type SearchPrefs } from './model'
import { AnswersSection, ExperienceSection, LabelValue, LookSection, VoiceSection, WantSection, WhereSection, WhoSection } from './sections'

/** GET/PATCH /api/onboarding (dates as strings). */
interface OnboardingPayload {
  profile: Record<string, unknown> | null
  resume: { id: string; fileName: string; sizeBytes: number; createdAt: string; parsedAt: string | null } | null
  prefs: SearchPrefs
  aiKeys: number
  hasPhoto: boolean
  account: { name: string; email: string | null }
  step: number
}

interface ValidationIssue {
  path?: string
  message?: string
}

function issuesOf(err: unknown): ValidationIssue[] {
  return err instanceof ApiError && Array.isArray(err.errors) ? (err.errors as ValidationIssue[]) : []
}

const ONBOARDING_URL = '/api/onboarding'

function parseStep(raw: string | null): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= STEP_COUNT ? n : null
}

/**
 * The first-run form. Each step is saved when you press Next (or Back), so the person can leave at
 * any time; the step lives in the URL (?step=N) and a fresh visit resumes at the first step whose
 * answers were never saved.
 */
export function OnboardingWizard({ accountName }: { accountName: string }) {
  const searchParams = useSearchParams()
  const qc = useQueryClient()
  const query = useApiQuery<OnboardingPayload>(['onboarding'], ONBOARDING_URL, { refetchOnWindowFocus: false })
  const payload = query.data?.data ?? null
  const remote = payload ? toDraft(payload.profile, { prefs: payload.prefs, account: payload.account }) : null
  const editable = useEditable<ProfileDraft>(remote)
  const { value: draft, commit } = editable
  const step = parseStep(searchParams.get('step')) ?? payload?.step ?? 1
  const def = stepDef(step)
  const topRef = useRef<HTMLDivElement>(null)
  const [stepError, setStepError] = useState<{ message: string; issues: ValidationIssue[] } | null>(null)

  const go = useCallback((n: number) => {
    const next = Math.min(Math.max(1, n), STEP_COUNT)
    // The native history API keeps useSearchParams in sync without a server round trip.
    window.history.pushState(null, '', `?step=${next}`)
    setStepError(null)
    topRef.current?.scrollIntoView({ block: 'start' })
  }, [])

  // Resume at the first unfinished step when the URL does not name one.
  useEffect(() => {
    if (payload && !parseStep(searchParams.get('step'))) window.history.replaceState(null, '', `?step=${payload.step}`)
  }, [payload, searchParams])

  const save = useApiMutation<{ step: number; data?: Record<string, unknown>; prefs?: SearchPrefs }, OnboardingPayload>((body) => api.patch<OnboardingPayload>(ONBOARDING_URL, body), {
    invalidate: [['profile']],
    silent: true,
    onSuccess: (data, envelope) => {
      // The cached GET must hold the saved answers too, or the form would briefly fall back to the old ones.
      qc.setQueryData<ApiEnvelope<OnboardingPayload>>(['onboarding', ONBOARDING_URL], envelope)
      commit(toDraft(data.profile, { prefs: data.prefs, account: data.account }))
    },
  })

  const finish = useApiMutation<{ prefs: SearchPrefs }, { onboardedAt: string }>((body) => api.post('/api/onboarding/finish', body), {
    silent: true,
    onSuccess: () => {
      toast.success('All set. Your first search starts from the dashboard.')
      // A full load so the server layouts see the finished onboarding.
      window.location.assign(new URL('/dashboard', window.location.origin).toString())
    },
  })

  /** Saves the current step (if it has fields), then moves. */
  const saveAndGo = async (target: number) => {
    if (!draft) return
    if (def.fields.length) {
      try {
        await save.mutateAsync({ step, data: toInput(draft, def.fields), ...(def.id === 'look' ? { prefs: draft.prefs } : {}) })
      } catch (err) {
        setStepError({ message: err instanceof Error ? err.message : 'Could not save this step', issues: issuesOf(err) })
        return
      }
    }
    go(target)
  }

  if (query.isError) {
    return (
      <Frame step={step} onPick={go}>
        <div className="rounded-lg border bg-danger-soft p-4 text-sm">
          <p className="font-medium text-danger-text">Could not load your answers</p>
          <p className="text-muted-foreground">{query.error.message}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      </Frame>
    )
  }
  if (!payload || !draft) {
    return (
      <Frame step={step} onPick={go}>
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Frame>
    )
  }

  const props = { d: draft, set: editable.set }
  const missing = missingForFinish({ fullName: draft.fullName, email: draft.email, country: draft.country, workAuth: { needsSponsorship: draft.needsSponsorship }, profession: draft.profession, titles: draft.titles }, draft.prefs)
  const saving = save.isPending
  const firstName = (draft.preferredName || draft.givenName || draft.fullName || accountName).split(/\s+/)[0]

  return (
    <Frame step={step} onPick={(n) => void saveAndGo(n)} topRef={topRef}>
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          Step {step} of {STEP_COUNT}
          {def.optional ? ' · optional' : ''}
        </p>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{step === 1 ? `Welcome, ${firstName}` : def.title}</h1>
        <p className="text-sm text-muted-foreground">{step === 1 ? `Ten short steps set the app up for you. ${def.description}` : def.description}</p>
      </header>

      <div className="flex flex-col gap-4">
        {def.id === 'keys' ? (
          <>
            <AiKeysCard title="Add an AI key (recommended)" intro="Paste or import keys from any supported provider: Gemini, Claude, OpenAI, DeepSeek, Groq, OpenRouter, Mistral, a local Ollama and more. Free tiers work." />
            <Hint>No key yet? Skip this step. The app still searches and collects jobs; add a key later in Settings &gt; AI.</Hint>
          </>
        ) : null}
        {def.id === 'cv' ? (
          <ResumeCard
            aiAvailable={payload.aiKeys > 0}
            onUploaded={(parsed) => {
              if (parsed) toast.success('Your CV was read. Check the next steps; everything can be changed.')
              void query.refetch()
            }}
          />
        ) : null}
        {def.id === 'who' ? <WhoSection {...props} hasPhoto={payload.hasPhoto} /> : null}
        {def.id === 'where' ? <WhereSection {...props} /> : null}
        {def.id === 'want' ? <WantSection {...props} /> : null}
        {def.id === 'look' ? <LookSection {...props} /> : null}
        {def.id === 'experience' ? <ExperienceSection {...props} /> : null}
        {def.id === 'answers' ? <AnswersSection {...props} /> : null}
        {def.id === 'voice' ? <VoiceSection {...props} /> : null}
        {def.id === 'review' ? <Review d={draft} aiKeys={payload.aiKeys} resume={payload.resume?.fileName ?? null} onEdit={go} missing={missing} /> : null}
      </div>

      {stepError ? (
        <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-text">
          <p className="font-medium">{stepError.message}</p>
          {stepError.issues.length ? (
            <ul className="mt-1 list-disc pl-4 text-xs">
              {stepError.issues.map((i, k) => (
                <li key={k}>
                  {i.path ? `${i.path}: ` : ''}
                  {i.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {finish.error ? (
        <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-text">
          {finish.error.message}
        </div>
      ) : null}

      <nav aria-label="Steps" className="sticky bottom-0 z-20 -mx-4 mt-2 border-t bg-background/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:mx-0 sm:rounded-lg sm:border sm:px-3">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" disabled={step === 1 || saving} onClick={() => void saveAndGo(step - 1)}>
            <ArrowLeft className="size-4" /> Back
          </Button>
          <div className="flex items-center gap-2">
            {def.optional && step < STEP_COUNT ? (
              <Button type="button" variant="outline" disabled={saving} onClick={() => go(step + 1)}>
                {def.id === 'keys' && payload.aiKeys === 0 ? 'Skip for now' : 'Skip'}
              </Button>
            ) : null}
            {step < STEP_COUNT ? (
              <Button type="button" disabled={saving} onClick={() => void saveAndGo(step + 1)}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                {saving ? 'Saving' : 'Next'}
                {saving ? null : <ArrowRight className="size-4" />}
              </Button>
            ) : (
              <Button type="button" disabled={missing.length > 0 || finish.isPending} onClick={() => finish.mutate({ prefs: draft.prefs })}>
                {finish.isPending ? <Loader2 className="size-4 animate-spin" /> : <PartyPopper className="size-4" />}
                {finish.isPending ? 'Setting things up' : 'Finish'}
              </Button>
            )}
          </div>
        </div>
      </nav>
    </Frame>
  )
}

/** Page frame: logo bar with the step list (scrolls sideways on phones) and a progress bar. */
function Frame({ step, onPick, topRef, children }: { step: number; onPick: (n: number) => void; topRef?: React.Ref<HTMLDivElement>; children: React.ReactNode }) {
  const pct = Math.round(((step - 1) / (STEP_COUNT - 1)) * 100)
  return (
    <>
      <div ref={topRef} className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pt-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <LogoMark size={26} /> Set up Job Pilot
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => void logoutAction()}>
            <LogOut className="size-3.5" /> Log out
          </Button>
        </div>
        <ol className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 py-2 scrollbar-none" aria-label="Onboarding steps">
          {STEPS.map((s) => {
            const done = s.n < step
            const current = s.n === step
            return (
              <li key={s.n} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onPick(s.n)}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                    current ? 'border-primary bg-primary-soft text-primary-text' : done ? 'border-transparent bg-muted text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted',
                  )}
                >
                  <span className={cn('flex size-4 items-center justify-center rounded-full text-[10px]', current ? 'bg-primary text-primary-foreground' : done ? 'bg-success-soft text-success-text' : 'bg-muted-foreground/20')}>
                    {done ? <Check className="size-3" aria-hidden /> : s.n}
                  </span>
                  {s.short}
                  {done ? <span className="sr-only">(visited)</span> : null}
                </button>
              </li>
            )
          })}
        </ol>
        <div className="h-1 w-full bg-muted" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">{children}</main>
    </>
  )
}

const label = <T extends string>(list: ReadonlyArray<{ value: T; label: string }>, v: string) => list.find((x) => x.value === v)?.label ?? ''
const join = (xs: string[]) => xs.filter(Boolean).join(', ')

function Review({ d, aiKeys, resume, onEdit, missing }: { d: ProfileDraft; aiKeys: number; resume: string | null; onEdit: (n: number) => void; missing: Array<{ step: number; label: string }> }) {
  const edit = (n: number) => (
    <Button type="button" size="sm" variant="outline" onClick={() => onEdit(n)} aria-label={`Edit ${stepDef(n).title}`}>
      Edit
    </Button>
  )
  const links = Object.entries(d.links).filter(([, v]) => v.trim())
  const diversityAnswered = DIVERSITY_TOPICS.filter((t) => d.diversity[t.key]).length
  return (
    <div className="flex flex-col gap-4">
      {missing.length ? (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning-text">
          <p className="font-medium">A few answers are still needed to finish:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {missing.map((m) => (
              <li key={m.label} className="flex flex-wrap items-center gap-2">
                <span>{m.label}</span>
                <Button type="button" size="xs" variant="outline" onClick={() => onEdit(m.step)}>
                  Go to step {m.step}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Hint>Everything needed is there. Finish builds your searches, ranking and standard answers from these answers; all of it can be changed later in Settings.</Hint>
      )}

      <SectionCard title="AI and CV" action={edit(1)}>
        <LabelValue label="AI keys" value={aiKeys ? `${aiKeys} saved` : 'None yet'} />
        <LabelValue label="CV" value={resume} />
      </SectionCard>
      <SectionCard title="Who you are" action={edit(3)}>
        <LabelValue label="Full name" value={d.fullName} />
        <LabelValue label="Preferred name" value={d.preferredName} />
        <LabelValue label="Pronouns" value={d.pronouns} />
        <LabelValue label="Email" value={d.email} />
        <LabelValue label="Phone" value={[d.phoneCountryCode, d.phone].filter(Boolean).join(' ')} />
        <LabelValue label="Links" value={links.length ? links.map(([k]) => LINK_LABELS[k as keyof typeof LINK_LABELS] ?? k).join(', ') : ''} />
      </SectionCard>
      <SectionCard title="Where you live and can work" action={edit(4)}>
        <LabelValue label="Lives in" value={join([d.city, countryLabel(d.country)])} />
        <LabelValue label="Time zone" value={d.timezone} />
        <LabelValue label="Citizenship" value={join(d.citizenships.map(countryLabel))} />
        <LabelValue label="Needs sponsorship" value={d.needsSponsorship === null ? '' : d.needsSponsorship ? 'Yes, outside the countries below' : 'No'} />
        <LabelValue label="Also allowed to work in" value={join(d.rightToWork.map(countryLabel))} />
        <LabelValue label="Relocation" value={label(RELOCATION_OPTIONS, d.relocation)} />
        <LabelValue label="Remote" value={label(REMOTE_OPTIONS, d.remote)} />
      </SectionCard>
      <SectionCard title="What you want" action={edit(5)}>
        <LabelValue label="Profession" value={d.profession === 'other' && d.field ? d.field : (PROFESSIONS.find((p) => p.id === d.profession)?.label ?? '')} />
        <LabelValue label="Target titles" value={join(d.titles)} />
        <LabelValue label="Seniority" value={join(d.seniority.map((s) => label(SENIORITY_OPTIONS, s)))} />
        <LabelValue label="Skills" value={d.skills.length ? `${d.skills.length}: ${d.skills.slice(0, 8).join(', ')}${d.skills.length > 8 ? ', ...' : ''}` : ''} />
        <LabelValue label="Never claim" value={join(d.stopSkills)} />
      </SectionCard>
      <SectionCard title="Where to look" action={edit(6)}>
        <LabelValue label="Countries" value={join(d.prefs.countries.map(countryLabel))} />
        <LabelValue label="First choice" value={join(d.prefs.firstChoice.map(countryLabel))} />
        <LabelValue label="Remote" value={d.prefs.remoteOnly ? 'Remote only' : d.prefs.includeRemote ? 'Included' : 'Not included'} />
        <LabelValue label="Minimum salary" value={d.prefs.minSalary ? `${d.prefs.minSalary.toLocaleString()} ${d.salaryCurrency}` : ''} />
        <LabelValue label="Languages" value={join(d.languageLevels.filter((l) => l.name).map((l) => `${l.name} (${label(LANGUAGE_LEVELS, l.level).toLowerCase()})`))} />
      </SectionCard>
      <SectionCard title="Experience and education" action={edit(7)}>
        <LabelValue label="Jobs" value={d.experience.length ? join(d.experience.map((e) => [e.title, e.company].filter(Boolean).join(' at '))) : ''} />
        <LabelValue label="Education" value={join(d.education.map((e) => [e.degree, e.school].filter(Boolean).join(', ')))} />
        <LabelValue label="Quotable facts" value={d.facts.length ? `${d.facts.length}` : ''} />
      </SectionCard>
      <SectionCard title="Standard form answers" action={edit(8)}>
        <LabelValue label="Notice period" value={d.noticePeriod} />
        <LabelValue label="Earliest start" value={d.earliestStart} />
        <LabelValue label="Expected salary" value={d.salaryExpectation ? `${d.salaryExpectation} ${d.salaryCurrency}${d.salaryOnlyWhenAsked ? ' (only when asked)' : ''}` : ''} />
        <LabelValue label="Diversity questions" value={diversityAnswered ? `${diversityAnswered} answered, the rest "Prefer not to say"` : 'All "Prefer not to say"'} />
      </SectionCard>
      <SectionCard title="Email voice" action={edit(9)}>
        <LabelValue label="Tone" value={d.tone.charAt(0).toUpperCase() + d.tone.slice(1)} />
        <LabelValue label="Lead with" value={join(d.leadWith)} />
        <LabelValue label="Never mention" value={join(d.neverMention)} />
        <LabelValue label="Sign-off" value={d.signOff} />
      </SectionCard>
    </div>
  )
}
