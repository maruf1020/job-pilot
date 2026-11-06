import { generateJson } from '@/lib/ai/gemini'
import { judgePrompt } from '@/lib/ai/prompts'
import { judgeSchema, type JudgeOutput } from '@/lib/ai/schemas'

export async function judgeDraft(subject: string, body: string, company: string, model: 'primary' | 'lite' = 'primary'): Promise<JudgeOutput> {
  const p = judgePrompt(subject, body, company)
  const r = await generateJson({ task: 'judge', model, schema: judgeSchema, system: p.system, prompt: p.prompt, temperature: 0.2, maxOutputTokens: 2048 })
  return r.data
}

export function describeJudge(j: JudgeOutput): string {
  const lines: string[] = []
  for (const t of j.tells) lines.push(`- [reads as AI] ${t}`)
  for (const s of j.suggestions) lines.push(`- [edit] ${s}`)
  return lines.join('\n')
}
