// Prints what the agents may say about the candidate: the profile facts, the right-to-work rule per
// country, and the saved form answers. Helper agents read this instead of facts written in briefs.
//   npx tsx scripts/ops/candidate-facts.ts [countryCode ...]
process.loadEnvFile(new URL('../../.env', import.meta.url))
async function main() {
  const { db } = await import('../../src/lib/db')
  const { loadCandidateContext } = await import('../../src/lib/candidate/load')
  const { identityFacts, workRightsSentence } = await import('../../src/lib/candidate/context')
  const ctx = await loadCandidateContext({ fresh: true })
  if (!ctx.fullName) {
    console.log('No profile yet: finish the onboarding form in the app first.')
    return
  }
  console.log('# Candidate facts (from the profile)')
  for (const f of identityFacts(ctx)) console.log(`- ${f}`)
  if (ctx.voice.neverMention.length) console.log(`- Never mention: ${ctx.voice.neverMention.join(', ')}`)
  if (ctx.voice.leadWith.length) console.log(`- Lead with: ${ctx.voice.leadWith.join(', ')}`)
  for (const cc of process.argv.slice(2)) console.log(`\n# Right to work in ${cc.toUpperCase()}\n${workRightsSentence(ctx, cc)}`)
  const answers = await db.answerBank.findMany({ where: { answer: { not: null } }, orderBy: { key: 'asc' }, select: { question: true, answer: true } })
  console.log(`\n# Saved form answers (${answers.length})`)
  for (const a of answers) console.log(`- ${a.question}: ${a.answer}`)
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
