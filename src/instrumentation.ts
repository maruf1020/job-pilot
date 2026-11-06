/**
 * Next.js calls register() once when the server starts. In development (`npm run dev`) it keeps the
 * search and apply workers running (src/instrumentation-node.ts); NO_WORKERS=1 turns it off.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'development' && process.env.NO_WORKERS !== '1') {
    await import('./instrumentation-node')
  }
}
