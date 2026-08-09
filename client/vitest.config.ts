import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const clientTestsDirectory = fileURLToPath(new URL('../tests/client', import.meta.url))

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: [`${clientTestsDirectory}/**/*.test.{ts,tsx}`],
    setupFiles: [`${clientTestsDirectory}/setup.ts`],
  },
})
