import { describe, expect, it } from 'vitest';
import { accounts, auditEvents, employees } from '@capella/database/schema';

import * as auth from '../../src/modules/auth/index.js';

describe('Cashier account persistence', () => {
  it('exports the production Drizzle repository', () => {
    expect(Reflect.get(auth, 'createDrizzleCashierAccountRepository')).toBeTypeOf('function');
  });

  it('locks and re-reads the account after locking the employee when enabling', async () => {
    const events: string[] = [];
    const auditRows: Array<{ beforeState?: unknown }> = [];
    const initial = {
      id: 5,
      username: 'stale-name',
      role: 'cashier' as const,
      employeeId: 7,
      branchId: 3,
      active: false,
    };
    const fresh = { ...initial, username: 'fresh-name' };
    let accountReads = 0;

    const transaction = {
      select() {
        return {
          from(table: unknown) {
            let locked = false;
            const builder = {
              innerJoin() { return builder; },
              where() { return builder; },
              for() {
                locked = true;
                events.push(table === employees ? 'employee-lock' : 'account-lock');
                return builder;
              },
              limit() {
                if (table === employees) {
                  return Promise.resolve([{
                    branchId: 3,
                    employmentStatus: 'active',
                    deletedAt: null,
                  }]);
                }
                accountReads += 1;
                events.push(`account-read-${accountReads}${locked ? '-locked' : ''}`);
                return Promise.resolve([accountReads === 1 ? initial : fresh]);
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
                if (table === accounts) events.push('account-update');
                return Promise.resolve();
              },
            };
          },
        };
      },
      insert(table: unknown) {
        return {
          values(value: { beforeState?: unknown }) {
            if (table === auditEvents) {
              events.push('audit');
              auditRows.push(value);
            }
            return Promise.resolve();
          },
        };
      },
    };
    const database = {
      transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) => callback(transaction),
    };
    const repository = auth.createDrizzleCashierAccountRepository(database as never);

    const result = await repository.setCashierActive({
      accountId: 5,
      active: true,
      updatedAt: new Date('2026-07-30T10:00:00.000Z'),
    });

    expect(result).toMatchObject({
      kind: 'updated',
      account: { username: 'fresh-name', active: true },
    });
    expect(auditRows[0]?.beforeState).toMatchObject({
      username: 'fresh-name',
      active: false,
    });
    expect(events).toEqual([
      'account-read-1',
      'employee-lock',
      'account-lock',
      'account-read-2-locked',
      'account-update',
      'audit',
    ]);
  });
});
