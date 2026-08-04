import path from 'node:path';

import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['@capella/testing/setup'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
