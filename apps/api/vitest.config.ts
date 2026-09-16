import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnvironment } from 'dotenv';
import { defineConfig } from 'vitest/config';

const apiDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(apiDirectory, '../..');
loadEnvironment({ path: path.join(workspaceRoot, '.env.test'), override: true, quiet: true });
process.env.NODE_ENV = 'test';

export default defineConfig({
  envDir: workspaceRoot,
  resolve: { conditions: ['development'] },
  test: {
    environment: 'node',
    setupFiles: ['@capella/testing/setup', './tests/mysql-integration-suite-setup.ts'],
    globalSetup: ['./tests/mysql-integration-global-setup.ts'],
    fileParallelism: false,
  },
});
