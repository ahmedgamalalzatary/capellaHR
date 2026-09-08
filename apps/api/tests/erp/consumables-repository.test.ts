import { describe, expect, it, vi } from 'vitest';

import { createDrizzleConsumablesRepository } from '../../src/modules/erp/consumables/consumables-repository.js';

describe('consumables repository transaction locking', () => {
  it('locks the cashier session before rejecting a closed or foreign shift', async () => {
    const lockedQueries: string[] = [];
    const rows = [
      [{ id: 11, branchId: 3, serviceId: 5, cashierSessionId: 9, status: 'completed' }],
      [],
      [],
    ];
    const select = vi.fn(() => {
      const result = rows.shift() ?? [];
      const query = {
        from: vi.fn(() => query),
        where: vi.fn(() => query),
        for: vi.fn((mode: string) => { lockedQueries.push(mode); return Promise.resolve(result); }),
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    });
    const database = { transaction: (work: (tx: unknown) => unknown) => work({ select }) };
    const repository = createDrizzleConsumablesRepository(database as never, { record: vi.fn() });

    await expect(repository.record({
      branchId: 3,
      accountId: 7,
      accountRole: 'cashier',
      serviceQueueEntryIds: [11],
      usages: [],
    })).rejects.toMatchObject({ code: 'CONSUMABLE_SHIFT_CLOSED' });

    expect(lockedQueries).toEqual(['update', 'update', 'update']);
  });
});
