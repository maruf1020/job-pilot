// Test every AI key stored in the app (any provider) and print which ones answer (keys are never printed).
// Usage: npx tsx scripts/gemini-keys-check.ts
process.loadEnvFile('.env')
async function main() {
  const { db } = await import('../src/lib/db')
  const { testStoredKey } = await import('../src/lib/keys/ai-keys')
  const keys = await db.aiKey.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }], select: { id: true, label: true, provider: true, keyHint: true, enabled: true } })
  console.log(`${keys.length} AI key(s) stored`)
  for (const k of keys) {
    const started = Date.now()
    const r = await testStoredKey(k.id)
    const tag = `${k.label} [${k.provider}] (...${k.keyHint.replace(/^[^\w]+/, '')})${k.enabled ? '' : ' (off)'}`
    console.log(r.ok ? `${tag}: OK in ${Date.now() - started} ms, ${r.models?.length ?? 0} models` : `${tag}: FAILED ${(r.error ?? '').slice(0, 140)}`)
  }
  await db.$disconnect()
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })

export {}
