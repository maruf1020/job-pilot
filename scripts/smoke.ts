/**
 * Live smoke checks against real services. Usage:
 *   npx tsx scripts/smoke.ts ai         # one JSON call through the key pool (any provider)
 *   npx tsx scripts/smoke.ts sources    # Arbeitnow page 1 + one Greenhouse board
 *   npx tsx scripts/smoke.ts draft      # full draft → lint → judge loop for a fake job
 *   npx tsx scripts/smoke.ts all
 */
process.loadEnvFile('.env')

const what = process.argv[2] ?? 'all'

async function ai() {
  const { generateJson } = await import('@/lib/ai/gemini')
  const { enrichBatchSchema } = await import('@/lib/ai/schemas')
  const { enrichPrompt } = await import('@/lib/ai/prompts')
  const p = enrichPrompt([
    {
      id: 'job1',
      title: 'Senior Frontend Engineer (React/TypeScript)',
      company: 'Acme Payments',
      location: 'Dublin, Ireland (Hybrid)',
      description:
        'We are a 120-person fintech in Dublin. You will own our merchant dashboard built with React 19, TypeScript and Node.js on PostgreSQL. 5+ years experience required. We sponsor Critical Skills Employment Permits and offer a relocation package for international hires. Apply by emailing careers@acmepayments.ie with your CV. Salary €75,000-€90,000.',
    },
  ])
  const started = Date.now()
  const r = await generateJson({ task: 'test', model: 'lite', schema: enrichBatchSchema, system: p.system, prompt: p.prompt, temperature: 0.2 })
  console.log(`ai ok in ${Date.now() - started} ms via key ${r.keyId} (${r.model}), tokens in/out ${r.usage.inputTokens}/${r.usage.outputTokens}`)
  console.log(JSON.stringify(r.data.items[0], null, 2))
}

async function sources() {
  const { arbeitnowAdapter } = await import('@/lib/sources/arbeitnow')
  const { fetchCompanyBoard } = await import('@/lib/sources/ats')
  const { DEFAULT_SEARCH } = await import('@/lib/settings/schema')
  const ctx = { search: DEFAULT_SEARCH, env: {}, fetch: globalThis.fetch, log: (l: string, m: string) => console.log(`  [${l}] ${m}`) }
  const a = await arbeitnowAdapter.fetch({ query: '', maxDaysOld: 60, page: 1 }, ctx)
  console.log(`arbeitnow: ${a.jobs.length} jobs, hasMore=${a.hasMore}`)
  for (const j of a.jobs.slice(0, 5)) console.log(`  - ${j.title} @ ${j.company} [${j.countryCode ?? '??'}] remote=${j.remote} visa=${j.visaSponsorship} desc=${j.description.length}ch`)
  const g = await fetchCompanyBoard({ id: 'x', name: 'Stripe', atsType: 'greenhouse', atsSlug: 'stripe', knownSponsor: true }, ctx, 90)
  console.log(`greenhouse/stripe: ${g.jobs.length} engineering roles (${g.requests} requests)`)
  for (const j of g.jobs.filter((j) => j.countryCode === 'IE').slice(0, 5)) console.log(`  - ${j.title} [${j.location}] ${j.url}`)
}

async function draft() {
  const { humanizeLoop } = await import('@/lib/pipeline/humanize/loop')
  const { generateJson } = await import('@/lib/ai/gemini')
  const { draftSchema } = await import('@/lib/ai/schemas')
  const { draftSystemPrompt, draftUserPrompt } = await import('@/lib/ai/prompts')
  const { getProfileForPrompt } = await import('@/lib/pipeline/profile')
  const { getSettings } = await import('@/lib/settings/service')
  const settings = await getSettings()
  const profile = await getProfileForPrompt()
  const job = {
    id: 'job1',
    title: 'Senior Frontend Engineer (React/TypeScript)',
    company: 'Acme Payments',
    location: 'Dublin, Ireland',
    countryCode: 'IE',
    description:
      'We are a 120-person fintech in Dublin. You will own our merchant dashboard built with React 19, TypeScript and Node.js on PostgreSQL, and help move a legacy Angular app over. 5+ years experience required. We sponsor Critical Skills Employment Permits and offer a relocation package.',
    summary: 'Fintech building a merchant dashboard; the role owns the React frontend and a migration off Angular.',
    mustHaveSkills: ['React', 'TypeScript', 'Node.js', 'PostgreSQL'],
    sponsorship: 'yes',
    hook: 'Their merchant dashboard is moving from Angular to React 19, which is close to the HRMS rebuild I led.',
  }
  const result = await humanizeLoop({
    ai: settings.ai,
    company: job.company,
    log: (m) => console.log(`  ${m}`),
    lintCtx: { companyName: job.company, mustHaveSkills: job.mustHaveSkills, profileFacts: profile.facts, profileName: profile.fullName, stopSkills: profile.stopSkills, kind: 'initial' },
    generate: async (rewrite) => {
      const input = { profile, job, ai: settings.ai, rewrite }
      const r = await generateJson({ task: 'test', model: 'primary', schema: draftSchema, system: draftSystemPrompt(input), prompt: draftUserPrompt(input), temperature: 0.9 })
      return { subject: r.data.subject, body: r.data.body, model: r.model }
    },
  })
  console.log(`\npassed=${result.passed} rounds=${result.rounds}`)
  console.log(`Subject: ${result.subject}\n\n${result.body}\n`)
  const last = result.versions.at(-1)!
  console.log('lint errors:', last.lint.errors.map((e) => e.message))
  console.log('lint warnings:', last.lint.warnings.map((e) => e.message))
  if (last.judge) console.log('judge:', last.judge.aiLikelihood, last.judge.tells)
}

const steps: Record<string, () => Promise<void>> = { ai, gemini: ai, sources, draft }
const run = what === 'all' ? Object.keys(steps) : [what]
async function main() {
  for (const name of run) {
  console.log(`\n=== ${name} ===`)
  try {
    await steps[name]()
  } catch (err) {
    console.error(`${name} FAILED:`, err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
  }
  process.exit()
}
void main()

export {}
