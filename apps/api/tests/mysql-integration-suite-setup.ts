import { afterAll, beforeAll, expect } from 'vitest';

import {
  closeMysqlIntegrationDatabase,
  createMysqlIntegrationDatabase,
  resetMysqlIntegrationDatabase,
} from './mysql-integration-database.js';

const isMysqlIntegrationFile = () =>
  expect.getState().testPath?.endsWith('.mysql.integration.test.ts') ?? false;

let database: ReturnType<typeof createMysqlIntegrationDatabase> | undefined;

beforeAll(async () => {
  if (!isMysqlIntegrationFile()) return;

  database = createMysqlIntegrationDatabase();
  await resetMysqlIntegrationDatabase(database);
});

afterAll(async () => {
  if (!database) return;
  await closeMysqlIntegrationDatabase(database);
});
