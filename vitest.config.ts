import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@core': resolve('src/core'),
      '@providers': resolve('src/providers')
    }
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] }
})
