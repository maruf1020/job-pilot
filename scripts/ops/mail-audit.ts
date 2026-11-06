// Gemini reads every job-related email since a start date (first argument as YYYY-MM-DD, default 90 days
// ago) that the app has not classified yet, and flags next steps (interview, assessment, questions) and
// location/visa refusals.
// Resumable: results go to mail-audit.json; already-checked ids are skipped. Read-only for Gmail.
process.loadEnvFile(new URL('../../.env', import.meta.url))
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const OUT = new URL('./out/mail-audit.json', import.meta.url)
type Row = { id: string; date: string | null; from: string; subject: string; category: string; company: string; role: string; action: string; deadline: string }

async function main() {
  const { z } = await import('zod')
  const { db } = await import('../../src/lib/db')
  const { getGmailClient, toLite } = await import('../../src/lib/email/gmail')
  const { generateJson } = await import('../../src/lib/ai/gemini')
  const { gmail } = await getGmailClient()

  const done: Row[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : []
  const checked = new Set(done.map((r) => r.id))
  // Already classified by the app (replies to sent emails, scanned portal mail with a verdict).
  const known = await db.emailMessage.findMany({ where: { direction: 'INBOUND' }, select: { providerMessageId: true } })
  const sorted = await db.inboxMessage.findMany({ where: { kind: { notIn: ['unmatched', 'other'] } }, select: { id: true } })
  for (const k of known) if (k.providerMessageId) checked.add(k.providerMessageId)
  for (const s of sorted) checked.add(s.id)

  const sinceArg = process.argv[2]
  const since = sinceArg && /^\d{4}-\d{2}-\d{2}$/.test(sinceArg) ? new Date(`${sinceArg}T00:00:00Z`) : new Date(Date.now() - 90 * 86_400_000)
  const q = `after:${since.toISOString().slice(0, 10).replace(/-/g, '/')} -in:sent -in:chats -in:drafts -category:promotions -category:social ` +
    '(interview OR "next step" OR "next steps" OR assessment OR challenge OR "work permit" OR visa OR sponsorship OR relocation OR "right to work" OR application OR candidacy OR applying OR recruiter OR recruitment OR hiring OR position OR bewerbung OR candidature)'
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 500, pageToken })
    for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id)
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  const todo = ids.filter((id) => !checked.has(id))
  console.log(`listed ${ids.length}, to check ${todo.length}`)

  const schema = z.object({
    category: z.enum(['NEXT_STEP', 'LOCATION_OR_VISA', 'REJECTION', 'CONFIRMATION', 'JOB_ALERT_OR_NEWSLETTER', 'OTHER']),
    company: z.string(),
    role: z.string(),
    action: z.string().describe('What the candidate must do next, in one short sentence; empty when nothing'),
    deadline: z.string().describe('A date or time limit named in the email, else empty'),
  })
  const system = 'You sort emails in the inbox of a job seeker who applied to jobs, sometimes in other countries. ' +
    'NEXT_STEP = a person or company invites the candidate to an interview, call, assessment or task, or asks questions, asks for documents, or asks for a reply. ' +
    'LOCATION_OR_VISA = they cannot hire the candidate because of location, time zone, work permit, visa or sponsorship. ' +
    'REJECTION = turned down for other reasons. CONFIRMATION = only confirms the application was received. ' +
    'JOB_ALERT_OR_NEWSLETTER = job recommendations, alerts, marketing. OTHER = anything else. Answer in JSON.'

  for (const id of todo) {
    let m
    try {
      m = toLite((await gmail.users.messages.get({ userId: 'me', id, format: 'full' })).data)
    } catch (err) {
      console.log(`stopped at Gmail limit: ${err instanceof Error ? err.message.slice(0, 100) : err}`)
      break
    }
    await new Promise((r) => setTimeout(r, 300))
    try {
      const r = (await generateJson({ task: 'classify_reply', model: 'lite', schema, system, prompt: `From: ${m.from}\nSubject: ${m.subject}\nDate: ${m.date?.toISOString() ?? ''}\n\n${m.text.slice(0, 3500)}`, temperature: 0, maxOutputTokens: 400 })).data
      done.push({ id, date: m.date?.toISOString() ?? null, from: m.from.slice(0, 80), subject: m.subject.slice(0, 120), ...r })
      if (r.category === 'NEXT_STEP' || r.category === 'LOCATION_OR_VISA') console.log(`${r.category} | ${m.date?.toISOString().slice(0, 10)} | ${r.company} | ${r.role} | ${r.action} ${r.deadline}`)
    } catch (err) {
      console.log(`Gemini stopped: ${err instanceof Error ? err.message.slice(0, 100) : err}`)
      break
    }
    if (done.length % 20 === 0) writeFileSync(OUT, JSON.stringify(done, null, 1))
  }
  writeFileSync(OUT, JSON.stringify(done, null, 1))
  const counts: Record<string, number> = {}
  for (const r of done) counts[r.category] = (counts[r.category] ?? 0) + 1
  console.log('totals', JSON.stringify(counts))
  process.exit(0)
}
main()
