import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.{test,spec}.{ts,js}', 'src/**/*.{test,spec}.{ts,js}'],
  },
})
