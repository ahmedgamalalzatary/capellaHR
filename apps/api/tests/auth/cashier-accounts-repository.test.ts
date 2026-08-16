import { describe, expect, it } from 'vitest';
import { accounts, auditEvents, authSessions, branches } from '@capella/database/schema';

import * as auth from '../../src/modules/auth/index.js';

const accountRow = {
  id: 5,
  username: 'nasr',
  role: 'cashier' as const,
  branchId: 3,
  branchName: 'فرع مدينة نصر',
  active: false,
};

describe('branch cashier account persistence', () => {
  it('exports the production Drizzle repository', () => {
    expect(Reflect.get(auth, 'createDrizzleCashierAccountRepository')).toBeTypeOf('function');
  });

  it('creates the first branch login and audits it in one transaction', async () => {
    const events: string[] = [];
    const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    let accountReads = 0;

    const transaction = {
      select() {
        return {
          from(table: unknown) {
            const builder = {
              innerJoin() { return builder; },
              where() { return builder; },
              for() { return builder; },
              limit() {
                if (table === branches) return Promise.resolve([{ id: 3 }]);
                accountReads += 1;
                events.push(`account-read-${accountReads}`);
                // 1st: existing branch login, 2nd: username owner, 3rd: re-read after insert.
                return Promise.resolve(accountReads === 3 ? [{ ...accountRow, active: true }] : []);
              },
            };
            return builder;
          },
        };
      },
      update(table: unknown) {
        return {
          set() {
            return {
              where() {
                events.push(table === accounts ? 'account-update' : 'session-revoke');
                return Promise.resolve();
              },
            };
          },
        };
      },
      insert(table: unknown) {
        return {
          values(value: Record<string, unknown>) {
            inserts.push({ table, values: value });
            if (table === auditEvents) events.push('audit');
            return Promise.resolve(table === accounts ? [{ insertId: 5 }] : []);
          },
        };
      },
    };
    const database = {
      transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) => callback(transaction),
    };
    const repository = auth.createDrizzleCashierAccountRepository(database as never);

    const result = await repository.upsert({
      username: 'nasr',
      passwordHash: 'hash:secret',
      role: 'cashier',
      branchId: 3,
      employeeId: null,
      createdAt: new Date('2026-08-16T10:00:00.000Z'),
      updatedAt: new Date('2026-08-16T10:00:00.000Z'),
    });

    expect(result).toMatchObject({
      kind: 'created',
      account: { id: 5, username: 'nasr', branchId: 3, branchName: 'فرع مدينة نصر', active: true },
    });
    expect(inserts).toEqual([
      expect.objectContaining({
        table: accounts,
        values: expect.objectContaining({
          username: 'nasr',
          passwordHash: 'hash:secret',
          role: 'cashier',
          branchId: 3,
          employeeId: null,
        }),
      }),
      expect.objectContaining({ table: auditEvents }),
    ]);
    expect(events).toEqual(['account-read-1', 'account-read-2', 'account-read-3', 'audit']);
  });

  it('rewrites the existing branch login instead of adding a second one', async () => {
    let accountReads = 0;
    const updates: unknown[] = [];
    const events: string[] = [];
    const transaction = {
      select() {
        return {
          from(table: unknown) {
            const builder = {
              innerJoin() { return builder; },
              where() { return builder; },
              for() { return builder; },
              limit() {
                if (table === branches) return Promise.resolve([{ id: 3 }]);
                accountReads += 1;
                // 1st: existing branch login row, 2nd: username owner (none), 3rd: re-read.
                return Promise.resolve(accountReads === 1
                  ? [{ id: 5, username: 'old-name', active: false }]
                  : accountReads === 3
                    ? [{ ...accountRow, active: true }]
                    : []);
              },
            };
            return builder;
          },
        };
      },
      update(table: unknown) {
        return {
          set(values: unknown) {
            return {
              where() {
                if (table === accounts) {
                  updates.push(values);
                  events.push('account-update');
                } else if (table === authSessions) {
                  events.push('session-revoke');
                }
                return Promise.resolve();
              },
            };
          },
        };
      },
      insert() {
        return {
          values() { return Promise.resolve([]); },
        };
      },
    };
    const database = {
      transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) => callback(transaction),
    };
    const repository = auth.createDrizzleCashierAccountRepository(database as never);

    const result = await repository.upsert({
      username: 'nasr',
      passwordHash: 'hash:next',
      role: 'cashier',
      branchId: 3,
      employeeId: null,
      createdAt: new Date('2026-08-16T10:00:00.000Z'),
      updatedAt: new Date('2026-08-16T11:00:00.000Z'),
    });

    expect(result.kind).toBe('updated');
    expect(updates).toEqual([expect.objectContaining({
      username: 'nasr',
      passwordHash: 'hash:next',
      active: true,
    })]);
    expect(events).toEqual(['account-update', 'session-revoke']);
  });

  it('translates a duplicate username race during update without revoking sessions', async () => {
    let accountReads = 0;
    const events: string[] = [];
    const transaction = {
      select() {
        return {
          from(table: unknown) {
            const builder = {
              innerJoin() { return builder; },
              where() { return builder; },
              for() { return builder; },
              limit() {
                if (table === branches) return Promise.resolve([{ id: 3 }]);
                accountReads += 1;
                return Promise.resolve(accountReads === 1
                  ? [{ id: 5, username: 'old-name', active: true }]
                  : []);
              },
            };
            return builder;
          },
        };
      },
      update(table: unknown) {
        return {
          set() {
            return {
              where() {
                events.push(table === accounts ? 'account-update' : 'session-revoke');
                if (table === accounts) {
                  return Promise.reject(Object.assign(
                    new Error('duplicate username'),
                    { cause: { code: 'ER_DUP_ENTRY' } },
                  ));
                }
                return Promise.resolve();
              },
            };
          },
        };
      },
    };
    const database = {
      transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) => callback(transaction),
    };
    const repository = auth.createDrizzleCashierAccountRepository(database as never);

    await expect(repository.upsert({
      username: 'claimed-concurrently',
      passwordHash: 'hash:next',
      role: 'cashier',
      branchId: 3,
      employeeId: null,
      createdAt: new Date('2026-08-16T10:00:00.000Z'),
      updatedAt: new Date('2026-08-16T11:00:00.000Z'),
    })).resolves.toEqual({ kind: 'username_taken' });
    expect(events).toEqual(['account-update']);
  });

  it('revokes live sessions when a branch login is disabled', async () => {
    const events: string[] = [];
    const transaction = {
      select() {
        return {
          from(table: unknown) {
            const builder = {
              innerJoin() { return builder; },
              where() { return builder; },
              for() { return builder; },
              limit() {
                if (table === branches) return Promise.resolve([{ id: 3 }]);
                return Promise.resolve([accountRow]);
              },
            };
            return builder;
          },
        };
      },
      update(table: unknown) {
        return {
          set() {
            return {
              where() {
                events.push(table === authSessions ? 'session-revoke' : 'account-update');
                return Promise.resolve();
              },
            };
          },
        };
      },
      insert() {
        return {
          values() { return Promise.resolve([]); },
        };
      },
    };
    const database = {
      transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) => callback(transaction),
    };
    const repository = auth.createDrizzleCashierAccountRepository(database as never);

    const result = await repository.setCashierActive({
      accountId: 5,
      active: false,
      updatedAt: new Date('2026-08-16T12:00:00.000Z'),
    });

    expect(result).toMatchObject({ kind: 'updated', account: { active: false } });
    expect(events).toEqual(['account-update', 'session-revoke']);
  });
});
