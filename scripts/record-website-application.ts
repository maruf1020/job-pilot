/**
 * Record an application submitted on a company website or a job board by hand (or by the
 * assistant on your instruction): the answers given, the form URL, the confirmation and
 * screenshots. The application page then shows it, the scoreboard counts it as a form
 * application, and the inbox scan links the company's emails to it.
 *
 *   npm run record:applied -- path/to/submission.json
 *
 * submission.json: { applicationId?, note?, formUrl?, finalUrl?, atsType?, confirmation?,
 *   by?: "you" | "assistant", fields?: [{ label, value, source }],
 *   screenshots?: ["relative/to/storage/apply-shots.jpg"],
 *   job?: { url, title, company, location?, countryCode?, description?, board? } }
 *
 * Without an applicationId, `job` describes a posting found on a job board (IrishJobs,
 * Relocate.me...): it is added to your jobs first, so the application has a home.
 */
import fs from 'node:fs'

interface BoardJob {
  url: string
  title: string
  company: string
  location?: string
  countryCode?: string
  description?: string
  /** Job board the application went through, e.g. "irishjobs.ie". */
  board?: string
}

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('Usage: npm run record:applied -- submission.json')
  const input = JSON.parse(fs.readFileSync(file, 'utf8')) as { applicationId?: string; note?: string; job?: BoardJob } & import('@/lib/apply/service').WebsiteSubmission
  const { markSubmittedByHand, ensureApplicationForJob } = await import('@/lib/apply/service')
  const { ingestNormalizedJob } = await import('@/lib/pipeline/ingest')
  const { db } = await import('@/lib/db')
  const { applicationId, note, job: boardJob, ...details } = input

  let appId = applicationId
  if (!appId) {
    if (!boardJob) throw new Error('Give an applicationId, or a job { url, title, company } for a job-board posting')
    const { jobId } = await ingestNormalizedJob({
      source: 'scrape',
      externalId: boardJob.url,
      url: boardJob.url,
      title: boardJob.title,
      company: boardJob.company,
      location: boardJob.location,
      countryCode: boardJob.countryCode,
      description: boardJob.description ?? '',
      tags: boardJob.board ? [`board:${boardJob.board}`] : [],
    })
    if (!jobId) throw new Error(`Could not add the job ${boardJob.title} at ${boardJob.company}`)
    appId = (await ensureApplicationForJob(jobId)).id
  }

  const app = await markSubmittedByHand(appId, note ?? null, details)
  const job = await db.job.findUnique({ where: { id: app.jobId }, select: { title: true, companyName: true } })
  console.log(`recorded: ${job?.companyName} · ${job?.title} (application ${app.id}, status ${app.status}, portal ${app.portalStatus})`)
  await db.$disconnect()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
