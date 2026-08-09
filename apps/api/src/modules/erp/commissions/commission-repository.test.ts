import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it, vi } from 'vitest';

import type { createDatabase } from '@capella/database';
import { createDrizzleCommissionRepository } from './commission-repository.js';

describe('commission repository', () => {
  it('requires list ledger employees to match the assigned invoice employee', async () => {
    const queries: string[] = [];
    const database = drizzle({
      client: { query: vi.fn().mockResolvedValue([[], []]) } as never,
      logger: { logQuery: (query) => queries.push(query) },
    }) as unknown as ReturnType<typeof createDatabase>;

    await createDrizzleCommissionRepository(database).list(2, {
      month: '2026-08', page: 1, pageSize: 20,
    });

    expect(queries[0]).toMatch(
      /commission_ledger_entries`.`employee_id`\s*=\s*`erp_invoices`.`assigned_employee_id`/,
    );
  });
});
