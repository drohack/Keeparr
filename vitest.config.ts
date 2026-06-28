import { defineConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Match the tsconfig "@/*" path alias so route/middleware tests can
      // import app modules the same way the app does.
      '@': root,
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['lib/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
