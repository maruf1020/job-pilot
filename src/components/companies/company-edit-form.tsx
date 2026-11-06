'use client'

import { useMemo, useState } from 'react'
import { Save, Undo2 } from 'lucide-react'
import { Section } from '@/components/shared/section'
import { Button } from '@/components/ui/button'
import { api, useApiMutation } from '@/lib/api/hooks'
import { CompanyFormFields } from './company-form'
import { companyToForm, formToPayload, validateCompanyForm, type CompanyBase, type CompanyFormValues, type CompanyPayload } from './types'

/** Keyed on `company.updatedAt` by the parent so it resets after every save. */
export function CompanyEditForm({ company }: { company: CompanyBase }) {
  const initial = useMemo(() => companyToForm(company), [company])
  const [values, setValues] = useState<CompanyFormValues>(initial)
  const [error, setError] = useState<string | null>(null)

  const save = useApiMutation<Partial<CompanyPayload>, CompanyBase>((body) => api.patch(`/api/companies/${company.id}`, body), {
    invalidate: [['companies'], ['jobs']],
    successMessage: 'Company saved',
  })

  const dirty = JSON.stringify(values) !== JSON.stringify(initial)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validateCompanyForm(values)
    setError(problem)
    if (problem) return
    save.mutate(formToPayload(values))
  }

  return (
    <Section id="profile" title="Company profile" description="What the pipeline knows about this employer. Blacklisting hides its future postings.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <CompanyFormFields values={values} onChange={(patch) => setValues((v) => ({ ...v, ...patch }))} disabled={save.isPending} idPrefix="edit-company" />
        {error ? <p className="text-xs text-danger-text">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" size="sm" disabled={!dirty || save.isPending} onClick={() => setValues(initial)}>
            <Undo2 className="size-3.5" /> Reset
          </Button>
          <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
            <Save className="size-3.5" /> {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Section>
  )
}
