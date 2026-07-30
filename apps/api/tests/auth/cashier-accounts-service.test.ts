import { describe, expect, it } from 'vitest';

import { createCashierAccountsService } from '../../src/modules/auth/cashier-accounts-service.js';

const setup = (result: 'created' | 'employee_not_found' | 'employee_inactive' | 'username_taken' | 'employee_already_has_account' = 'created') => {
  const promoted: unknown[] = [];
  return {
    promoted,
    service: createCashierAccountsService({
      accounts: {
        promoteEmployeeToCashier: async (account) => {
          promoted.push(account);
          return result === 'created'
            ? { kind: 'created' as const, account: {
                id: 11, username: account.username, role: 'cashier' as const,
                employeeId: account.employeeId, branchId: 3, active: true,
                passwordHash: 'must-never-escape',
              } }
            : { kind: result };
        },
      },
      hashPassword: async (password) => `hash:${password}`,
      now: () => new Date('2026-07-29T12:00:00.000Z'),
    }),
  };
};

describe('cashier account promotion', () => {
  it('creates an employee-linked account scoped to the employee branch', async () => {
    const { service, promoted } = setup();

    const account = await service.promote({ employeeId: 7, username: ' Cashier.One ', password: 'secret' });

    expect(account).toMatchObject({ id: 11, employeeId: 7, branchId: 3, username: 'cashier.one', role: 'cashier' });
    expect(promoted).toEqual([expect.objectContaining({
      employeeId: 7,
      username: 'cashier.one',
      passwordHash: 'hash:secret',
      role: 'cashier',
    })]);
    expect(account).not.toHaveProperty('passwordHash');
  });

  it.each([
    ['missing or deleted', 'employee_not_found' as const, 'EMPLOYEE_NOT_FOUND'],
    ['inactive', 'employee_inactive' as const, 'EMPLOYEE_INACTIVE'],
    ['duplicate username', 'username_taken' as const, 'USERNAME_TAKEN'],
    ['already promoted employee', 'employee_already_has_account' as const, 'EMPLOYEE_ALREADY_HAS_ACCOUNT'],
  ])('rejects a %s employee after atomic revalidation', async (_case, result, code) => {
    const { service, promoted } = setup(result);

    await expect(service.promote({ employeeId: 7, username: 'cashier', password: 'secret' }))
      .rejects.toMatchObject({ code });
    expect(promoted).toHaveLength(1);
  });
});
