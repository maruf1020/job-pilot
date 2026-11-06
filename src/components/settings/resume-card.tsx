'use client'

import { useRef, useState } from 'react'
import { Download, FileText, Loader2, RefreshCw, Sparkles, Upload } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { fmtDateTime } from '@/lib/format'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Hint, SectionCard } from './fields'
import type { ProfilePayload } from './profile-form'

const INVALIDATE = [['profile'], ['onboarding']]
const MAX_BYTES = 5 * 1024 * 1024

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The CV: upload (and read it with AI when a key exists), download, read again. Used in
 * Settings > Profile and in onboarding step 2.
 */
export function ResumeCard({ aiAvailable, onUploaded, title = 'Your CV' }: { aiAvailable?: boolean; onUploaded?: (parsed: boolean) => void; title?: string }) {
  const query = useApiQuery<ProfilePayload>(['profile'], '/api/profile')
  const keys = useApiQuery<Array<{ enabled: boolean }>>(['ai-keys'], aiAvailable === undefined ? '/api/settings/ai-keys' : null)
  const canParse = aiAvailable ?? (keys.data?.data ?? []).some((k) => k.enabled)
  const resume = query.data?.data.resume ?? null
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useApiMutation<{ file: File; parse: boolean }, { parsed: boolean }>(
    ({ file: f, parse }) => {
      const fd = new FormData()
      fd.append('file', f, f.name)
      return api.post(`/api/profile/resume${parse ? '' : '?parse=false'}`, fd)
    },
    {
      invalidate: INVALIDATE,
      onSuccess: (data) => {
        setFile(null)
        if (inputRef.current) inputRef.current.value = ''
        onUploaded?.(Boolean(data?.parsed))
      },
    },
  )
  const reparse = useApiMutation<void, unknown>(() => api.put('/api/profile/resume'), { invalidate: INVALIDATE })

  const busy = upload.isPending || reparse.isPending
  const parsing = upload.isPending ? upload.variables?.parse : false
  const tooBig = file ? file.size > MAX_BYTES : false

  return (
    <SectionCard title={title} description={canParse ? 'A PDF, up to 5 MB. With "Upload and read with AI" your details are filled in from it; you can change everything afterwards.' : 'A PDF, up to 5 MB. It is attached to applications.'}>
      {query.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : resume ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{resume.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {fmtBytes(resume.sizeBytes)} · uploaded {fmtDateTime(resume.createdAt)}
                {resume.parsedAt ? ` · read ${fmtDateTime(resume.parsedAt)}` : ' · not read by AI yet'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            <Button size="sm" variant="outline" nativeButton={false} render={<a href="/api/profile/resume" download={resume.fileName} />}>
              <Download className="size-3.5" /> Download
            </Button>
            {canParse ? (
              <ConfirmButton
                size="sm"
                variant="outline"
                title="Read the CV with AI again?"
                description="The CV text is sent to your AI provider again and the profile fields it covers (name, skills, experience and so on) are replaced with the result."
                confirmLabel="Read again"
                onConfirm={() => reparse.mutateAsync()}
                disabled={busy}
              >
                {reparse.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Read again with AI
              </ConfirmButton>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No CV uploaded yet.</p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="resume-file">{resume ? 'Replace the CV' : 'Upload your CV'}</Label>
        <Input ref={inputRef} id="resume-file" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy} />
        {tooBig ? <p className="text-xs text-danger-text">That file is {fmtBytes(file?.size ?? 0)}; the limit is 5 MB.</p> : null}
        <div className="flex flex-wrap gap-2">
          {canParse ? (
            <Button size="sm" disabled={!file || tooBig || busy} onClick={() => file && upload.mutate({ file, parse: true })}>
              {parsing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {parsing ? 'Reading your CV' : 'Upload and read with AI'}
            </Button>
          ) : null}
          <Button size="sm" variant={canParse ? 'outline' : 'default'} disabled={!file || tooBig || busy} onClick={() => file && upload.mutate({ file, parse: false })}>
            {upload.isPending && !parsing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {canParse ? 'Upload only' : 'Upload'}
          </Button>
        </div>
        {canParse ? (
          <p className="text-xs text-muted-foreground">&quot;Upload only&quot; stores the PDF for applications and leaves your details as they are.</p>
        ) : (
          <Hint>No AI key yet, so the CV is stored but not read. Add a key in Settings &gt; AI to fill your details from it later.</Hint>
        )}
      </div>
    </SectionCard>
  )
}
