'use client'

import { useState } from 'react'
import { Landmark } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { fmtAgo, fmtNumber } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

type Country = 'IE' | 'GB' | 'NL'
const COUNTRIES: Array<{ code: Country; label: string; help: string }> = [
  { code: 'IE', label: 'Ireland', help: 'Employment permits issued per employer this year (Department of Enterprise).' },
  { code: 'GB', label: 'United Kingdom', help: 'Home Office register of licensed sponsors, Skilled Worker route (about 100,000 employers).' },
  { code: 'NL', label: 'Netherlands', help: 'IND public register of recognised sponsors for highly skilled migrants.' },
]

interface Summary {
  country: string
  rows: number
  source: string | null
  importedAt: string | null
}

/** "Import sponsor registers": official lists of employers that sponsor, matched to the companies list. */
export function SponsorRegistersDialog() {
  const [open, setOpen] = useState(false)
  const [countries, setCountries] = useState<Country[]>(['IE', 'GB', 'NL'])
  const summary = useApiQuery<Summary[]>(['sponsor-registers'], '/api/companies/sponsor-registers')
  const run = useApiMutation((body: { countries: Country[] }) => api.post('/api/companies/sponsor-registers', body), {
    invalidate: [['sponsor-registers'], ['companies'], ['jobs']],
    onSuccess: () => setOpen(false),
  })
  const rows = summary.data?.data ?? []
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Landmark className="size-4" /> Sponsor registers
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import official sponsor registers</DialogTitle>
          <DialogDescription>
            Employers on these government lists actually sponsor permits. Matching companies are marked as known sponsors (ranking boost, sponsorship treated as likely), and new companies are checked against the lists as they arrive.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {COUNTRIES.map((c) => {
            const s = rows.find((r) => r.country === c.code)
            return (
              <label key={c.code} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                <Checkbox checked={countries.includes(c.code)} onCheckedChange={(v) => setCountries((prev) => (v ? [...new Set([...prev, c.code])] : prev.filter((x) => x !== c.code)))} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">
                    {c.label}
                    {s?.rows ? <span className="ml-2 text-xs font-normal text-muted-foreground">{fmtNumber(s.rows)} employers, imported {fmtAgo(s.importedAt)}</span> : <span className="ml-2 text-xs font-normal text-muted-foreground">not imported yet</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{c.help}</span>
                </span>
              </label>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={run.isPending || countries.length === 0} onClick={() => run.mutate({ countries })}>
            {run.isPending ? 'Importing… (up to a minute)' : 'Import and match'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
