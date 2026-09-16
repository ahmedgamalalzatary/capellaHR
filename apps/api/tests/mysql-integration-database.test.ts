import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetMysqlIntegrationDatabase } from './mysql-integration-database.js';

afterEach(() => {
  delete process.env.DATABASE_URL;
});

describe('MySQL integration database safety', () => {
  it('rejects a non-test database before opening a reset connection', async () => {
    const getConnection = vi.fn();
    const database = { $client: { promise: () => ({ getConnection }) } };
    process.env.DATABASE_URL = 'mysql://root:pass@localhost/capella_hr';

    await expect(resetMysqlIntegrationDatabase(database as never))
      .rejects.toThrow('MySQL integration database must use a test database');
    expect(getConnection).not.toHaveBeenCalled();
  });
});
