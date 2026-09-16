import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createDatabase: vi.fn(), migrate: vi.fn() }));
vi.mock('@capella/database', () => ({ createDatabase: mocks.createDatabase }));
vi.mock('drizzle-orm/mysql2/migrator', () => ({ migrate: mocks.migrate }));

import setup from './mysql-integration-global-setup.js';

afterEach(() => {
  delete process.env.DATABASE_URL;
  vi.clearAllMocks();
});

describe('MySQL integration global setup', () => {
  it('migrates the configured test database without replacing or dropping it', async () => {
    const end = vi.fn();
    const database = { $client: { promise: () => ({ end }) } };
    mocks.createDatabase.mockReturnValueOnce(database);
    process.env.DATABASE_URL = 'mysql://root:pass@localhost/capella_hr-test';

    const teardown = await setup();
    await teardown();

    expect(mocks.createDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.createDatabase).toHaveBeenCalledWith(process.env.DATABASE_URL);
    expect(mocks.migrate).toHaveBeenCalledWith(database, expect.anything());
    expect(end).toHaveBeenCalledTimes(1);
  });
});
