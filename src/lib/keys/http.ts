import { HttpError } from '@/lib/api/response'
import { KeyError } from './ai-keys'

/** Run a key operation and turn its KeyError (400/404/409) into the API's HttpError. */
export async function keyCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof KeyError) throw new HttpError(err.status, err.message)
    throw err
  }
}
