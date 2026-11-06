// List the models each stored AI key can use ("Discover models" from the command line).
// Usage: npx tsx scripts/models.ts [filter]   e.g. npx tsx scripts/models.ts flash
process.loadEnvFile('.env')
async function main() {
  const { db } = await import('../src/lib/db')
  const { decryptSecret } = await import('../src/lib/crypto')
  const { adapterFor } = await import('../src/lib/ai/adapters')
  const { providerOrCustom } = await import('../src/lib/ai/providers')
  const filter = process.argv[2] ? new RegExp(process.argv[2], 'i') : null
  const keys = await db.aiKey.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] })
  for (const k of keys) {
    const p = providerOrCustom(k.provider)
    try {
      const models = await adapterFor(k.provider).listModels(decryptSecret(k.encryptedKey), k.baseUrl || p.baseUrl)
      const shown = filter ? models.filter((m) => filter.test(m)) : models
      console.log(`\n${k.label} [${p.label}] ${shown.length} model(s)${filter ? ` matching ${filter}` : ''}:\n  ${shown.join('\n  ')}`)
    } catch (e) {
      console.log(`\n${k.label} [${p.label}]: list failed: ${e instanceof Error ? e.message.slice(0, 200) : e}`)
    }
  }
  await db.$disconnect()
}
void main()

export {}
