import { useSyncExternalStore } from 'react'

const noSubscribe = () => () => {}

/**
 * False on the server and while hydrating, true after. Data a query already cached when a Suspense
 * boundary hydrates late (counts fetched by the page header, for example) must wait for this, or the
 * client HTML differs from the server's.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  )
}
