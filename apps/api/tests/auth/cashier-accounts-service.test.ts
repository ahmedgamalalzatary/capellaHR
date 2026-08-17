import { describe, expect, it } from 'vitest';

import { createCashierAccountsService } from '../../src/modules/auth/cashier-accounts-service.js';

const account = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  username: 'nasr',
  role: 'cashier' as const,
  branchId: 3,
  branchName: 'فرع مدينة نصر',
  active: true,
  ...overrides,
});

const setup = (
  result: 'created' | 'updated' | 'branch_not_found' | 'username_taken' = 'created',
  statusResult: 'updated' | 'not_found' = 'updated',
) => {
  const upserts: unknown[] = [];
  const statusChanges: unknown[] = [];
  const passwordChanges: unknown[] = [];
  const archives: unknown[] = [];
  return {
    upserts,
    statusChanges,
    passwordChanges,
    archives,
    service: createCashierAccountsService({
      accounts: {
        upsert: async (input) => {
          upserts.push(input);
          return result === 'created'
            ? { kind: 'created' as const, account: account({
              username: input.username, branchId: input.branchId, active: true,
            }) }
            : result === 'updated'
              ? { kind: 'updated' as const, account: account({
                username: input.username, branchId: input.branchId, active: true,
              }) }
              : { kind: result };
        },
        listCashiers: async () => ({ items: [account()], total: 1 }),
        setCashierActive: async (input) => {
          statusChanges.push(input);
          return statusResult === 'not_found'
            ? { kind: 'not_found' as const }
            : { kind: 'updated' as const, account: account({ active: input.active }) };
        },
        archiveCashier: async (input) => {
          archives.push(input);
          return statusResult === 'not_found'
            ? { kind: 'not_found' as const }
            : { kind: 'archived' as const, account: account({ active: false }) };
        },
        updateCashierPassword: async (input) => {
          passwordChanges.push(input);
          return statusResult === 'not_found'
            ? { kind: 'not_found' as const }
            : { kind: 'updated' as const, account: account() };
        },
      },
      hashPassword: async (password) => `hash:${password}`,
      now: () => new Date('2026-08-16T12:00:00.000Z'),
    }),
  };
};

describe('branch cashier accounts', () => {
  it('creates the single branch login with normalized credentials', async () => {
    const { service, upserts } = setup();

    const created = await service.upsert({ branchId: 3, username: ' Nasr ', password: 'secret' });

    expect(created).toEqual(account({ username: 'nasr' }));
    expect(created).not.toHaveProperty('passwordHash');
    expect(created).not.toHaveProperty('employeeId');
    expect(upserts).toEqual([expect.objectContaining({
      branchId: 3,
      username: 'nasr',
      passwordHash: 'hash:secret',
      role: 'cashier',
      employeeId: null,
    })]);
  });

  it('reuses the existing account when the branch login is reassigned', async () => {
    const { service, upserts } = setup('updated');

    const updated = await service.upsert({ branchId: 3, username: 'nasr', password: 'next' });

    expect(updated).toEqual(account());
    expect(upserts).toHaveLength(1);
  });

  it.each([
    ['unknown branch', 'branch_not_found' as const, 'BRANCH_NOT_FOUND'],
    ['username owned by another account', 'username_taken' as const, 'USERNAME_TAKEN'],
  ])('rejects a %s after atomic revalidation', async (_case, result, code) => {
    const { service, upserts } = setup(result);

    await expect(service.upsert({ branchId: 3, username: 'nasr', password: 'secret' }))
      .rejects.toMatchObject({ code });
    expect(upserts).toHaveLength(1);
  });

  it('lists branch logins and manages status and credentials', async () => {
    const { service, statusChanges, passwordChanges } = setup();

    await expect(service.list({ page: 1, pageSize: 20 })).resolves.toMatchObject({ total: 1 });
    await expect(service.setActive(11, false)).resolves.toMatchObject({ active: false });
    await expect(service.resetPassword(11, 'new-secret')).resolves.toMatchObject({ id: 11 });

    expect(statusChanges).toEqual([{ accountId: 11, active: false, updatedAt: expect.any(Date) }]);
    expect(passwordChanges).toEqual([{
      accountId: 11,
      passwordHash: 'hash:new-secret',
      updatedAt: expect.any(Date),
    }]);
  });

  it('rejects status and password changes for unknown accounts', async () => {
    const { service } = setup('created', 'not_found');

    await expect(service.setActive(11, true)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    await expect(service.resetPassword(11, 'next')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('retires a branch login instead of erasing the history that points at it', async () => {
    const { service, archives } = setup();

    await expect(service.archive(11)).resolves.toMatchObject({ id: 11, active: false });

    expect(archives).toEqual([{ accountId: 11, archivedAt: expect.any(Date) }]);
  });

  it('rejects retiring an account that is not there', async () => {
    const { service } = setup('created', 'not_found');

    await expect(service.archive(11)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });
});
