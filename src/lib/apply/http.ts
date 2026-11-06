import { HttpError } from '@/lib/api/response'
import { PortalActionError } from './service'

/** Map browser-agent action errors to API errors (status + message + details). */
export async function asHttp<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (err) {
    if (err instanceof PortalActionError) throw new HttpError(err.status, err.message, err.details)
    throw err
  }
}
