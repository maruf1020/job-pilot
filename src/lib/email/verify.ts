import { promises as dns } from 'node:dns'
import net from 'node:net'

/**
 * Mailbox verification without sending mail: connect to the domain's MX server and
 * ask whether it would accept the address (RCPT TO). Many providers accept any
 * address ("catch-all"), some block probes, and home ISPs often block port 25,
 * so every answer other than a clear yes/no is reported as unknown.
 */

export type VerifyOutcome = 'valid' | 'invalid' | 'catch_all' | 'unknown'

export interface VerifyResult {
  outcome: VerifyOutcome
  detail: string
}

const PROBE_FROM = ''
const PROBE_HELO = 'probe.job-pilot.local'
const CONNECT_TIMEOUT_MS = 8000
const STEP_TIMEOUT_MS = 8000

/** In-process caches so a batch does not re-probe the same domain. */
const catchAllCache = new Map<string, boolean>()
let consecutiveConnectFailures = 0
let port25Blocked = false

export function isPort25Blocked(): boolean {
  return port25Blocked
}

export function resetVerifyState(): void {
  catchAllCache.clear()
  consecutiveConnectFailures = 0
  port25Blocked = false
}

/** Parse one SMTP reply (possibly multi-line). Returns the 3-digit code and whether the reply is complete. */
export function parseSmtpReply(buffer: string): { code: number; complete: boolean; text: string } {
  const lines = buffer.split(/\r?\n/).filter((l) => l.length > 0)
  const last = lines[lines.length - 1] ?? ''
  const m = /^(\d{3})([ -])/.exec(last)
  if (!m) return { code: 0, complete: false, text: buffer }
  return { code: Number(m[1]), complete: m[2] === ' ', text: buffer.trim() }
}

interface SmtpSession {
  send: (line: string) => Promise<{ code: number; text: string }>
  close: () => void
}

function openSession(host: string, port = 25): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let buffer = ''
    let pending: { resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null
    const fail = (err: Error) => {
      if (pending) {
        clearTimeout(pending.timer)
        pending.reject(err)
        pending = null
      }
      reject(err)
    }
    const connectTimer = setTimeout(() => {
      socket.destroy()
      fail(new Error('connect timeout'))
    }, CONNECT_TIMEOUT_MS)
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const reply = parseSmtpReply(buffer)
      if (!reply.complete) return
      buffer = ''
      if (pending) {
        clearTimeout(pending.timer)
        const p = pending
        pending = null
        p.resolve({ code: reply.code, text: reply.text })
      } else if (reply.code === 220) {
        clearTimeout(connectTimer)
        resolve({
          send: (line) =>
            new Promise((res, rej) => {
              const timer = setTimeout(() => {
                socket.destroy()
                rej(new Error('reply timeout'))
              }, STEP_TIMEOUT_MS)
              pending = { resolve: res, reject: rej, timer }
              socket.write(`${line}\r\n`)
            }),
          close: () => {
            try {
              socket.write('QUIT\r\n')
            } catch {
              /* ignore */
            }
            socket.end()
            socket.destroy()
          },
        })
      } else {
        clearTimeout(connectTimer)
        socket.destroy()
        fail(new Error(`unexpected greeting ${reply.code}`))
      }
    })
    socket.on('error', (err) => {
      clearTimeout(connectTimer)
      fail(err)
    })
    socket.on('close', () => {
      if (pending) fail(new Error('connection closed'))
    })
  })
}

async function mxHosts(domain: string): Promise<string[]> {
  try {
    const mx = await dns.resolveMx(domain)
    return mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange).slice(0, 2)
  } catch {
    return []
  }
}

function randomLocal(): string {
  return `zz-probe-${Math.random().toString(36).slice(2, 10)}`
}

/** Probe one mailbox on one MX host. */
async function probe(host: string, email: string, domain: string): Promise<VerifyResult> {
  const session = await openSession(host)
  try {
    const ehlo = await session.send(`EHLO ${PROBE_HELO}`)
    if (ehlo.code >= 400) return { outcome: 'unknown', detail: `EHLO rejected (${ehlo.code})` }
    const from = await session.send(`MAIL FROM:<${PROBE_FROM}>`)
    if (from.code >= 400) return { outcome: 'unknown', detail: `MAIL FROM rejected (${from.code})` }
    const rcpt = await session.send(`RCPT TO:<${email}>`)
    if (rcpt.code === 250 || rcpt.code === 251) {
      // Accepted: distinguish a real mailbox from a catch-all domain (cached per domain).
      let catchAll = catchAllCache.get(domain)
      if (catchAll === undefined) {
        const probeAddr = `${randomLocal()}@${domain}`
        const rnd = await session.send(`RCPT TO:<${probeAddr}>`)
        catchAll = rnd.code === 250 || rnd.code === 251
        catchAllCache.set(domain, catchAll)
      }
      return catchAll ? { outcome: 'catch_all', detail: 'server accepts any address' } : { outcome: 'valid', detail: `accepted by ${host}` }
    }
    if (rcpt.code >= 500) {
      // 550/551/553: no such user, relaying denied, etc. Only treat explicit "user" rejections as invalid.
      if (/user|mailbox|recipient|address|exist|unknown|no such/i.test(rcpt.text) || rcpt.code === 550) {
        return { outcome: 'invalid', detail: `rejected (${rcpt.code})` }
      }
      return { outcome: 'unknown', detail: `rejected (${rcpt.code}) without a mailbox reason` }
    }
    return { outcome: 'unknown', detail: `temporary reply (${rcpt.code}), maybe greylisting` }
  } finally {
    session.close()
  }
}

/**
 * Verify a mailbox. Never throws; network problems come back as `unknown`.
 * After two consecutive connection failures the session assumes port 25 is blocked and stops probing.
 */
export async function verifyMailbox(email: string): Promise<VerifyResult> {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return { outcome: 'invalid', detail: 'malformed address' }
  if (port25Blocked) return { outcome: 'unknown', detail: 'outbound port 25 appears blocked on this machine' }
  const hosts = await mxHosts(domain)
  if (hosts.length === 0) return { outcome: 'invalid', detail: 'domain has no mail servers' }
  let lastDetail = ''
  for (const host of hosts) {
    try {
      const r = await probe(host, email, domain)
      consecutiveConnectFailures = 0
      return r
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err)
      if (/timeout|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(lastDetail)) {
        consecutiveConnectFailures++
        if (consecutiveConnectFailures >= 2) port25Blocked = true
      }
    }
  }
  return { outcome: 'unknown', detail: lastDetail || 'no mail server answered' }
}

/** Verify candidates in order; returns the first valid one plus what was learned. */
export async function verifyCandidates(candidates: string[], max = 4): Promise<{ valid: string | null; invalid: string[]; catchAll: boolean; unknown: boolean; details: string[] }> {
  const invalid: string[] = []
  const details: string[] = []
  let catchAll = false
  let unknown = false
  for (const email of candidates.slice(0, max)) {
    const r = await verifyMailbox(email)
    details.push(`${email}: ${r.outcome} (${r.detail})`)
    if (r.outcome === 'valid') return { valid: email, invalid, catchAll, unknown, details }
    if (r.outcome === 'invalid') invalid.push(email)
    else if (r.outcome === 'catch_all') {
      catchAll = true
      break // every other guess on this domain would "pass" too
    } else {
      unknown = true
      if (port25Blocked) break
    }
  }
  return { valid: null, invalid, catchAll, unknown, details }
}
