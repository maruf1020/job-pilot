export type ParsedMessage =
  | { kind: 'command'; name: string; args: string[]; rest: string }
  | { kind: 'text'; text: string }
  | { kind: 'empty' }
  /** "/status@other_bot": addressed to a different bot. */
  | { kind: 'other-bot' }

/**
 * Splits a message into a command and its words, or plain text. "/job@MyBot  acme dev" gives name "job",
 * args ["acme","dev"], rest "acme dev". Only the first word decides: "hello /status" is text.
 */
export function parseMessage(raw: string | undefined | null, botUsername?: string | null): ParsedMessage {
  const text = (raw ?? '').trim()
  if (!text) return { kind: 'empty' }
  if (!text.startsWith('/')) return { kind: 'text', text }
  const m = /^\/([A-Za-z][A-Za-z0-9_]*)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(text)
  if (!m) return { kind: 'text', text }
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return { kind: 'other-bot' }
  const rest = (m[3] ?? '').trim()
  return { kind: 'command', name: m[1].toLowerCase(), args: rest ? rest.split(/\s+/) : [], rest }
}
