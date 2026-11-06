/**
 * Run `fn` over `items` with at most `limit` in flight, in input order. Returning `false` from `fn`
 * (or a `shouldStop` that says yes) stops new items from starting; items already running finish.
 * The first error stops the pool too and is rethrown once the running items are done.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<boolean | void>,
  shouldStop?: () => Promise<boolean> | boolean,
): Promise<{ started: number; stopped: boolean }> {
  let next = 0
  let stopped = false
  let failure: { err: unknown } | null = null
  const lane = async () => {
    while (!stopped && next < items.length) {
      if (shouldStop && (await shouldStop())) {
        stopped = true
        break
      }
      const i = next++
      try {
        if ((await fn(items[i], i)) === false) stopped = true
      } catch (err) {
        failure ??= { err }
        stopped = true
      }
    }
  }
  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  await Promise.all(Array.from({ length: lanes }, lane))
  if (failure) throw (failure as { err: unknown }).err
  return { started: next, stopped }
}
