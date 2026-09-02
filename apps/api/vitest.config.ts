import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnvironment } from 'dotenv';
import { defineConfig } from 'vitest/config';

const apiDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(apiDirectory, '../..');
loadEnvironment({ path: path.join(workspaceRoot, '.env.test'), override: true, quiet: true });
process.env.NODE_ENV = 'test';
const mysqlIntegrationDatabaseUrl = new URL(process.env.DATABASE_URL ?? '');
mysqlIntegrationDatabaseUrl.pathname = `/capella_hr_test_shared_${process.pid}_${Date.now()}`;
process.env.CAPELLA_MYSQL_INTEGRATION_DATABASE_URL = mysqlIntegrationDatabaseUrl.toString();

export default defineConfig({
  envDir: workspaceRoot,
  resolve: { conditions: ['development'] },
  test: {
    environment: 'node',
    setupFiles: ['@capella/testing/setup'],
    globalSetup: ['./tests/mysql-integration-global-setup.ts'],
    fileParallelism: false,
  },
});
