// Teach the form driver: save a pinned lesson for this site template in the SiteLesson table (the driver
// reads it on the next form of the same kind). The person's own details are replaced with {placeholders}.
// Args: <form url> "<lesson>"
process.loadEnvFile(new URL('../../.env', import.meta.url))
async function main() {
  const { siteKind } = await import('../../src/lib/apply/driver')
  const { keepLesson } = await import('../../src/lib/apply/lessons')
  const [url, lesson] = process.argv.slice(2)
  if (!url || !lesson) throw new Error('usage: add-lesson.ts <url> "<lesson>"')
  const kind = siteKind(url)
  if (!(await keepLesson({ kind, url, lesson: lesson.slice(0, 400), outcome: 'pinned' }))) throw new Error('the lesson could not be saved (is the database running?)')
  console.log(`lesson saved for ${kind}`)
  process.exit(0)
}
main()
