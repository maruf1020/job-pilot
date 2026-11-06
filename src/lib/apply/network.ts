import dns from 'node:dns/promises'

/**
 * "net::ERR_NAME_NOT_RESOLVED" failed 120 attempts in October, most of them in one burst while the
 * PC's connection was down. Telling a dead site from a dead connection keeps those from counting as
 * tries at the job.
 */

export const NAME_NOT_RESOLVED_RE = /ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_RESOLUTION_FAILED|ENOTFOUND|EAI_AGAIN/i

export function isNameNotResolved(message: string): boolean {
  return NAME_NOT_RESOLVED_RE.test(message)
}

/** The connection works when a few big, always-up names resolve. */
export async function networkUp(lookup: (host: string) => Promise<unknown> = (h) => dns.lookup(h)): Promise<boolean> {
  for (const host of ['google.com', 'cloudflare.com', 'microsoft.com']) {
    try {
      await lookup(host)
      return true
    } catch {
      /* try the next one */
    }
  }
  return false
}
