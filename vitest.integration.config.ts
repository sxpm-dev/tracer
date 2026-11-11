import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
const root = import.meta.dirname;
export default defineConfig({
  resolve: { alias: {
    '@sx/tracing': resolve(root, 'packages/tracing/src/index.ts'),
    '@sx/recordings': resolve(root, 'packages/recordings/src/index.ts'),
  } },
  test: {
    environment: 'jsdom', globals: true,
    maxWorkers: 2,
    include: ['tests/**/*.spec.{ts,tsx}'],
    setupFiles: [resolve(root, 'scripts/tracing-test-setup.ts')],
  },
});
