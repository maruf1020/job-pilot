'use client'

import { useRef, useState, type DragEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Import, Loader2, ScanSearch } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, useApiQuery } from '@/lib/api/hooks'
import { cn } from '@/lib/utils'
import { ToneBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { OptionSelect } from '@/components/onboarding/pickers'

/** GET /api/settings/ai-providers: the providers a key can belong to. */
export interface ProviderInfo {
  id: string
  label: string
  adapter: string
  needsBaseUrl: boolean
  keyOptional: boolean
  keyPlaceholder: string
  keysUrl: string | null
  defaultPrimary: string | null
  defaultLite: string | null
  vision: boolean
  webSearch: boolean
}

export const PROVIDERS_URL = '/api/settings/ai-providers'

export function useProviders() {
  return useApiQuery<ProviderInfo[]>(['ai-providers'], PROVIDERS_URL, { staleTime: 5 * 60_000 })
}

/** POST /api/keys/import/preview -> one row per key found in the pasted text or file. */
export interface PreviewItem {
  ref: string
  kind: 'ai' | 'service'
  provider?: string
  service?: string
  label: string
  keyHint: string
  detectedBy: 'name' | 'format' | 'probe' | 'unknown'
  candidates?: string[]
  duplicate: boolean
  test?: { ok: boolean; error?: string }
  suggested?: { primaryModel?: string; liteModel?: string }
}

interface PreviewResult {
  items: PreviewItem[]
  warnings: string[]
}

interface CommitResult {
  added: number
  skipped: number
  errors: string[]
}

const DETECTED: Record<PreviewItem['detectedBy'], string> = {
  name: 'by variable name',
  format: 'by key format',
  probe: 'by a live test',
  unknown: 'not recognised',
}

const MAX_FILE = 512 * 1024

/** Paste or drop keys (.env, .txt, .json), check what was found, then import the chosen rows. */
export function KeyImportDialog({ triggerLabel = 'Import keys', triggerVariant = 'outline' }: { triggerLabel?: string; triggerVariant?: 'outline' | 'default' }) {
  const qc = useQueryClient()
  const providers = useProviders()
  const providerLabel = new Map((providers.data?.data ?? []).map((p) => [p.id, p.label]))
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [providerFor, setProviderFor] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CommitResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setText('')
    setPreview(null)
    setPicked({})
    setProviderFor({})
    setError(null)
    setResult(null)
  }

  const readFile = async (file: File) => {
    if (file.size > MAX_FILE) {
      setError('That file is too large for a key list (over 512 KB).')
      return
    }
    setText(await file.text())
    setPreview(null)
    setResult(null)
    setError(null)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void readFile(file)
  }

  /** A row needs a provider choice when detection was unsure; until then it cannot be imported. */
  const needsChoice = (it: PreviewItem) => it.kind === 'ai' && (it.detectedBy === 'unknown' || !it.provider || (it.candidates?.length ?? 0) > 1)
  const chosenProvider = (it: PreviewItem) => providerFor[it.ref] ?? (needsChoice(it) ? '' : (it.provider ?? ''))
  const importable = (it: PreviewItem) => !it.duplicate && (it.kind === 'service' || Boolean(chosenProvider(it)))

  const runPreview = async () => {
    setBusy('preview')
    setError(null)
    setResult(null)
    try {
      const env = await api.post<PreviewResult>('/api/keys/import/preview', { text })
      setPreview(env.data)
      // Pre-tick what can be imported and is not known to be broken.
      setPicked(Object.fromEntries(env.data.items.map((it) => [it.ref, !it.duplicate && it.test?.ok !== false && !needsChoice(it)])))
      setProviderFor(Object.fromEntries(env.data.items.filter((it) => needsChoice(it) && it.candidates?.length === 1).map((it) => [it.ref, it.candidates![0]])))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not read the keys')
    } finally {
      setBusy(null)
    }
  }

  const items = preview?.items ?? []
  const selected = items.filter((it) => picked[it.ref] && importable(it))

  const runCommit = async () => {
    setBusy('commit')
    setError(null)
    try {
      const env = await api.post<CommitResult>('/api/keys/import/commit', {
        text,
        picks: selected.map((it) => ({ ref: it.ref, ...(it.kind === 'ai' ? { provider: chosenProvider(it) } : {}), label: it.label })),
      })
      setResult(env.data)
      for (const k of [['ai-keys'], ['service-keys'], ['ai-usage'], ['status'], ['onboarding']]) void qc.invalidateQueries({ queryKey: k })
      if (env.data.added) toast.success(`Imported ${env.data.added} key${env.data.added === 1 ? '' : 's'}`)
      if (!env.data.errors.length) {
        setOpen(false)
        reset()
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The import failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger render={<Button size="sm" variant={triggerVariant} />}>
        <Import className="size-3.5" /> {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import keys</DialogTitle>
          <DialogDescription>
            Paste keys or drop a .env, .txt or .json file. Lines like NAME=value, JSON objects and bare keys all work. Nothing is saved until you press Import; the text is not kept.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn('flex flex-col gap-2 rounded-lg border border-dashed p-2 transition-colors', dragging && 'border-primary bg-primary-soft/40')}
          >
            <Label htmlFor="key-import-text" className="sr-only">
              Keys to import
            </Label>
            <Textarea
              id="key-import-text"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setPreview(null)
                setResult(null)
              }}
              rows={6}
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-xs"
              placeholder={'GEMINI_API_KEY=...\nANTHROPIC_API_KEY=...\nsk-or-...'}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Or drop a file here.</p>
              <input
                ref={fileRef}
                type="file"
                accept=".env,.txt,.json,text/plain,application/json"
                className="sr-only"
                id="key-import-file"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void readFile(f)
                  e.target.value = ''
                }}
              />
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <FileUp className="size-3.5" /> Choose a file
              </Button>
            </div>
          </div>

          <Button type="button" variant="secondary" className="self-start" disabled={!text.trim() || busy !== null} onClick={() => void runPreview()}>
            {busy === 'preview' ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
            {busy === 'preview' ? 'Checking keys' : 'Check keys'}
          </Button>

          {preview ? (
            items.length === 0 ? (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">No keys found in that text.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <ul className="divide-y" aria-label="Keys found">
                  {items.map((it) => {
                    const can = importable(it)
                    const name = it.kind === 'service' ? (it.service ?? 'Service') : providerLabel.get(chosenProvider(it)) || it.provider || 'Unknown provider'
                    const options = (it.candidates?.length ? it.candidates : (providers.data?.data ?? []).map((p) => p.id)).map((id) => ({ value: id, label: providerLabel.get(id) ?? id }))
                    return (
                      <li key={it.ref} className="flex items-start gap-3 p-3">
                        <Checkbox
                          className="mt-0.5"
                          checked={Boolean(picked[it.ref]) && can}
                          disabled={!can}
                          onCheckedChange={(c) => setPicked((p) => ({ ...p, [it.ref]: c }))}
                          aria-label={`Import ${it.label}`}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                            <span className="font-medium">{name}</span>
                            <ToneBadge tone={it.kind === 'ai' ? 'accent' : 'neutral'}>{it.kind === 'ai' ? 'AI' : 'service'}</ToneBadge>
                            <code className="rounded bg-muted px-1 font-mono text-[11px] text-muted-foreground">...{it.keyHint}</code>
                            {it.duplicate ? <ToneBadge tone="muted">already saved</ToneBadge> : null}
                            {it.test ? (
                              <ToneBadge tone={it.test.ok ? 'success' : 'danger'} dot>
                                {it.test.ok ? 'works' : 'failed'}
                              </ToneBadge>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {it.label} · found {DETECTED[it.detectedBy]}
                            {it.suggested?.primaryModel ? ` · models ${[it.suggested.primaryModel, it.suggested.liteModel].filter(Boolean).join(' / ')}` : ''}
                          </p>
                          {it.test && !it.test.ok && it.test.error ? <p className="line-clamp-2 text-xs wrap-break-word text-danger-text">{it.test.error}</p> : null}
                          {needsChoice(it) && !it.duplicate ? (
                            <div className="flex max-w-xs flex-col gap-1">
                              <Label htmlFor={`imp-provider-${it.ref}`} className="text-xs">
                                Which provider is this key for?
                              </Label>
                              <OptionSelect
                                id={`imp-provider-${it.ref}`}
                                value={chosenProvider(it)}
                                onChange={(v) => {
                                  setProviderFor((p) => ({ ...p, [it.ref]: v }))
                                  if (v) setPicked((p) => ({ ...p, [it.ref]: true }))
                                }}
                                emptyLabel="Choose a provider"
                                options={options}
                              />
                            </div>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          ) : null}

          {preview?.warnings.length ? (
            <ul className="list-disc rounded-md bg-warning-soft py-2 pr-3 pl-7 text-xs text-warning-text">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          {result?.errors.length ? (
            <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger-text">
              <p className="font-medium">
                Imported {result.added}, skipped {result.skipped}. These failed:
              </p>
              <ul className="mt-1 list-disc pl-4">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter showCloseButton>
          <Button type="button" disabled={!selected.length || busy !== null} onClick={() => void runCommit()}>
            {busy === 'commit' ? <Loader2 className="size-3.5 animate-spin" /> : <Import className="size-3.5" />}
            {selected.length ? `Import ${selected.length} selected` : 'Import selected'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
