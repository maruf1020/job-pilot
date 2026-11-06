'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { api, useApiMutation } from '@/lib/api/hooks'
import { CompanyFormFields } from './company-form'
import { EMPTY_COMPANY_FORM, formToPayload, validateCompanyForm, type CompanyBase, type CompanyFormValues, type CompanyPayload } from './types'

export function AddCompanyDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<CompanyFormValues>(EMPTY_COMPANY_FORM)
  const [error, setError] = useState<string | null>(null)

  const create = useApiMutation<CompanyPayload, CompanyBase>((body) => api.post('/api/companies', body), {
    invalidate: [['companies']],
    successMessage: (c) => `${c.name} saved`,
    onSuccess: (c) => {
      setOpen(false)
      setValues(EMPTY_COMPANY_FORM)
      router.push(`/companies/${c.id}`)
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validateCompanyForm(values)
    setError(problem)
    if (problem) return
    create.mutate(formToPayload(values))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-3.5" /> Add company
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add company</DialogTitle>
            <DialogDescription>Track a company manually. Set an ATS type and slug to pull its board on every search run. Existing companies with the same name are updated.</DialogDescription>
          </DialogHeader>
          <CompanyFormFields values={values} onChange={(patch) => setValues((v) => ({ ...v, ...patch }))} disabled={create.isPending} idPrefix="new-company" showBlacklist={false} />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Save company'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
