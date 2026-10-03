import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnvironment } from 'dotenv';
import { defineConfig } from 'vitest/config';

const apiDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(apiDirectory, '../..');
loadEnvironment({ path: path.join(workspaceRoot, '.env.test'), override: true, quiet: true });
process.env.NODE_ENV = 'test';

const databaseTests = ['tests/**/*-mysql.integration.test.ts'];

export default defineConfig({
  envDir: workspaceRoot,
  resolve: { conditions: ['development'] },
  test: {
    environment: 'node',
    // Vitest 3 shares each pool across projects: keep the database in its own
    // single-worker fork pool so it cannot block the parallel unit thread pool.
    poolOptions: { forks: { minForks: 1, maxForks: 1 } },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: databaseTests,
          pool: 'threads',
        },
      },
      {
        extends: true,
        test: {
          name: 'database',
          include: databaseTests,
          pool: 'forks',
          setupFiles: ['./tests/mysql-integration-suite-setup.ts'],
          globalSetup: ['./tests/mysql-integration-global-setup.ts'],
        },
      },
    ],
  },
});
