import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // The browser engine test runs Chromium in parallel; give the other tests room on a busy machine.
    testTimeout: 20_000,
  },
})
