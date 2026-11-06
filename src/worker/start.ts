// Entry point: load .env before any module that validates the environment.
// (scripts/with-env.mjs and container hosts provide the environment themselves and set SKIP_DOTENV.)
if (!process.env.SKIP_DOTENV) {
  try {
    process.loadEnvFile('.env')
  } catch {
    // .env is optional when the environment is provided by the host
  }
}

// A stray browser promise (a file-picker wait that timed out after its click failed) used to kill
// the worker and every running agent with it: log it and keep going.
process.on('unhandledRejection', (err) => {
  console.error(`[worker:main] unhandled rejection (kept running): ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
})

void import('./main')

export {}
