import { describe, expect, it, vi } from 'vitest';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import type { SQL } from 'drizzle-orm';

import { createDrizzleInvoiceSequenceStore } from '../../src/modules/erp/sales/invoice-sequence-store.js';

describe('ERP invoice sequence store', () => {
  it('uses one autocommitted atomic statement and returns MySQL LAST_INSERT_ID', async () => {
    let capturedQuery: SQL | undefined;
    const execute = vi.fn((query: SQL) => {
      capturedQuery = query;
      return Promise.resolve([{ insertId: 23 }]);
    });
    const store = createDrizzleInvoiceSequenceStore({ execute } as never);

    await expect(store.allocate('2026-08-04', new Date('2026-08-03T22:30:00.000Z')))
      .resolves.toBe(23);
    expect(execute).toHaveBeenCalledOnce();
    expect(capturedQuery).toBeDefined();
    if (!capturedQuery) throw new Error('Expected a captured SQL query');
    const statement = new MySqlDialect().sqlToQuery(capturedQuery).sql;
    expect(statement).toContain('LAST_INSERT_ID');
    expect(statement).toContain('ON DUPLICATE KEY UPDATE');
  });
});
