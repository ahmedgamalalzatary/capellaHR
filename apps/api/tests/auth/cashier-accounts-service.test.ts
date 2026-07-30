import { describe, expect, it } from 'vitest';

import { createCashierAccountsService } from '../../src/modules/auth/cashier-accounts-service.js';

const setup = (
  result: 'created' | 'employee_not_found' | 'employee_inactive' | 'username_taken' | 'employee_already_has_account' = 'created',
  statusResult: 'updated' | 'employee_inactive' = 'updated',
) => {
  const promoted: unknown[] = [];
  const statusChanges: unknown[] = [];
  const passwordChanges: unknown[] = [];
  return {
    promoted,
    statusChanges,
    passwordChanges,
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
        listCashiers: async () => ({ items: [{
          id: 11, username: 'cashier.one', role: 'cashier' as const,
          employeeId: 7, branchId: 3, active: true,
        }], total: 1 }),
        setCashierActive: async (input) => {
          statusChanges.push(input);
          return statusResult === 'employee_inactive'
            ? { kind: 'employee_inactive' as const }
            : { kind: 'updated' as const, account: {
            id: 11, username: 'cashier.one', role: 'cashier' as const,
            employeeId: 7, branchId: 3, active: input.active,
          } };
        },
        updateCashierPassword: async (input) => {
          passwordChanges.push(input);
          return { kind: 'updated' as const, account: {
            id: 11, username: 'cashier.one', role: 'cashier' as const,
            employeeId: 7, branchId: 3, active: true,
          } };
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

  it('lists Cashiers and manages status and credentials', async () => {
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

  it('rejects enabling an account linked to an inactive employee', async () => {
    const { service, statusChanges } = setup('created', 'employee_inactive');

    await expect(service.setActive(11, true)).rejects.toMatchObject({
      code: 'EMPLOYEE_INACTIVE',
    });
    expect(statusChanges).toEqual([{ accountId: 11, active: true, updatedAt: expect.any(Date) }]);
  });
});
