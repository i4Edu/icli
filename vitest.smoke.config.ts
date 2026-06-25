import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/smoke/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
