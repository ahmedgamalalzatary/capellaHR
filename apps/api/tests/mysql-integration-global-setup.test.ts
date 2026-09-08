import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createDatabase: vi.fn(), migrate: vi.fn() }));
vi.mock('@capella/database', () => ({ createDatabase: mocks.createDatabase }));
vi.mock('drizzle-orm/mysql2/migrator', () => ({ migrate: mocks.migrate }));

import setup from './mysql-integration-global-setup.js';

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.CAPELLA_MYSQL_INTEGRATION_DATABASE_URL;
  vi.clearAllMocks();
});

describe('MySQL integration global setup', () => {
  it('migrates the shared test database and reserves the control URL for cleanup', async () => {
    const controlEnd = vi.fn();
    const create = vi.fn();
    const sharedEnd = vi.fn();
    const control = { $client: { promise: () => ({ end: controlEnd, query: create }) } };
    const shared = { $client: { promise: () => ({ end: sharedEnd }) } };
    mocks.createDatabase.mockReturnValueOnce(control).mockReturnValueOnce(shared);
    process.env.DATABASE_URL = 'mysql://root:pass@localhost/control';
    process.env.CAPELLA_MYSQL_INTEGRATION_DATABASE_URL = 'mysql://root:pass@localhost/capella_hr_test_shared_1_2';

    await setup();

    expect(mocks.createDatabase).toHaveBeenNthCalledWith(1, process.env.DATABASE_URL);
    expect(create).toHaveBeenCalledWith(
      'CREATE DATABASE `capella_hr_test_shared_1_2` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    );
    expect(mocks.createDatabase).toHaveBeenNthCalledWith(2, process.env.CAPELLA_MYSQL_INTEGRATION_DATABASE_URL);
    expect(mocks.migrate).toHaveBeenCalledWith(shared, expect.anything());
    expect(controlEnd).toHaveBeenCalledTimes(1);
    expect(sharedEnd).toHaveBeenCalledTimes(1);
  });
});
