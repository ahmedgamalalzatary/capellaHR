import { describe, expect, it } from 'vitest';
import { accounts, auditEvents, authSessions, branches, branchCashierRoster, employees } from '@capella/database/schema';
import { createDrizzleCashierAccountRepository } from '../../src/modules/auth/cashier-accounts-repository.js';

// The database boundary records actual writes; failed transactions discard staged changes.
function setup(options: { current?: boolean; employeeValid?: boolean; failRoster?: boolean } = {}) {
  const current = options.current ?? true;
  const writes: Array<{ table: unknown; values: Record<string, unknown> | unknown[] }> = [];
  let reads = 0;
  const tx = {
    select() {
      return { from(table: unknown) {
        const rows = () => {
          if (table === branches) return [{ id: 3 }];
          if (table === employees) return options.employeeValid === false ? [] : [{ id: 7 }];
          if (table === branchCashierRoster) return [{ id: 9, fullName: 'ليلى حسن', branchId: 3 }];
          reads += 1;
          if (reads === 2) return [];
          return current || reads > 2 ? [{ id: 5, username: 'nasr', role: 'cashier', branchId: 3, branchName: 'Nasr', active: false }] : [];
        };
        const builder = {
          innerJoin() { return builder; }, leftJoin() { return builder; },
          where() { return builder; }, for() { return builder; }, orderBy() { return builder; },
          limit() {
            const result = Promise.resolve(rows()) as Promise<unknown[]> & { offset: () => Promise<unknown[]> };
            result.offset = () => Promise.resolve(rows());
            return result;
          },
          then(resolve: (value: unknown[]) => unknown) {
            return Promise.resolve(table === accounts ? [{ total: 1 }] : rows()).then(resolve);
          },
        };
        return builder;
      } };
    },
    update(table: unknown) { return { set(values: Record<string, unknown>) { return { where() { writes.push({ table, values }); return Promise.resolve(); } }; } }; },
    delete(table: unknown) { return { where() { writes.push({ table, values: { deleted: true } }); return Promise.resolve(); } }; },
    insert(table: unknown) { return { values(values: Record<string, unknown> | unknown[]) {
      if (table === branchCashierRoster && options.failRoster) throw new Error('roster storage failed');
      writes.push({ table, values });
      return Promise.resolve([{ insertId: 5 }]);
    } }; },
  };
  const database = {
    async transaction<T>(run: (executor: typeof tx) => Promise<T>) {
      try { return await run(tx); } catch (error) { writes.length = 0; throw error; }
    },
    select() { return tx.select(); },
  };
  return { writes, repository: createDrizzleCashierAccountRepository(database as never) };
}

const input = {
  username: 'nasr', role: 'cashier' as const, branchId: 3, employeeId: null,
  createdAt: new Date(), updatedAt: new Date(),
  management: { mode: 'edit' as const, accountId: 5 },
};

describe('atomic cashier account management', () => {
  it('keeps password, disabled status and sessions when credentials are unchanged', async () => {
    const { repository, writes } = setup();
    await repository.upsert(input);
    const accountWrite = writes.find(({ table }) => table === accounts)?.values;
    expect(accountWrite).not.toHaveProperty('passwordHash');
    expect(accountWrite).not.toHaveProperty('active');
    expect(writes.some(({ table }) => table === authSessions)).toBe(false);
    expect(writes.some(({ table }) => table === branchCashierRoster)).toBe(false);
    expect(writes.filter(({ table }) => table === auditEvents)).toHaveLength(1);
  });
  it('revokes sessions when the username or password changes', async () => {
    for (const change of [{ username: 'new-name' }, { passwordHash: 'new-hash' }]) {
      const { repository, writes } = setup();
      await repository.upsert({ ...input, ...change });
      expect(writes.some(({ table }) => table === authSessions)).toBe(true);
    }
  });
  it('does not overwrite an existing login when creating', async () => {
    const { repository, writes } = setup();
    expect(await repository.upsert({ ...input, passwordHash: 'hash', management: { mode: 'create' } }))
      .toEqual({ kind: 'branch_has_account' });
    expect(writes).toEqual([]);
  });
  it('does not edit a replacement account after the original was deleted', async () => {
    const { repository, writes } = setup();
    expect(await repository.upsert({ ...input, management: { mode: 'edit', accountId: 99 } }))
      .toEqual({ kind: 'not_found' });
    expect(writes).toEqual([]);
  });
  it('returns account credentials after save and list', async () => {
    const { repository } = setup();
    const saved = await repository.upsert(input);
    expect(saved).toMatchObject({
      kind: 'updated',
      account: { id: 5 },
    });
    expect(await repository.listCashiers({ page: 1, pageSize: 20 })).toEqual({
      items: [{
        id: 5, username: 'nasr', role: 'cashier', branchId: 3, branchName: 'Nasr', active: false,
      }],
      total: 1,
    });
  });
});
