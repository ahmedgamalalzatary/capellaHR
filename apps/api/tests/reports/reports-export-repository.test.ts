import { describe, expect, it } from 'vitest';

import type { Database } from '../../src/modules/payroll/financial-repository-helpers.js';
import { createDrizzleReportExportRepository } from '../../src/modules/reports/index.js';

describe('report export repository failures', () => {
  it('propagates a database failure while locking a retry candidate', async () => {
    const failure = new Error('database unavailable');
    const transaction = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: () => ({ limit: async () => Promise.reject(failure) }),
          }),
        }),
      }),
    };
    const database = {
      transaction: (callback: (executor: typeof transaction) => unknown) => callback(transaction),
    } as unknown as Database;

    const repository = createDrizzleReportExportRepository(database);

    await expect(repository.retryFailed(17, new Date())).rejects.toBe(failure);
  });
});
