import { describe, expect, it, vi } from 'vitest';

import { createBranchCashierRosterService } from '../../src/modules/erp/sales/index.js';

const cashier = { role: 'cashier' as const, accountId: 8, branchId: 3 };
const admin = { role: 'admin' as const, accountId: 1 };

const setup = (replaceResult: 'replaced' | 'employee_not_in_branch' = 'replaced') => {
  const repository = {
    listByBranch: vi.fn(async () => [
      { id: 7, employeeCode: 1007, fullName: 'أحمد جمال' },
      { id: 9, employeeCode: 1009, fullName: 'منى سعيد' },
    ]),
    replace: vi.fn(async (input: { employeeIds: number[] }) => (
      replaceResult === 'replaced'
        ? {
            kind: 'replaced' as const,
            members: input.employeeIds.map((id, index) => ({
              id, employeeCode: 1007 + index, fullName: `عضو ${id}`,
            })),
          }
        : { kind: replaceResult }
    )),
  };
  const resolveBranchContext = vi.fn(async (
    actor: { role: 'admin' | 'cashier'; accountId: number },
    branchId?: number,
  ) => ({
    accountId: actor.accountId,
    accountRole: actor.role,
    branchId: branchId ?? 3,
    employeeId: null,
  }));
  const service = createBranchCashierRosterService({
    repository,
    resolveBranchContext,
    now: () => new Date('2026-08-16T12:00:00.000Z'),
  });
  return { repository, resolveBranchContext, service };
};

describe('branch cashier roster service', () => {
  it('lists the roster of the acting branch for a cashier', async () => {
    const { repository, service } = setup();

    await expect(service.list(cashier, {})).resolves.toEqual([
      { id: 7, employeeCode: 1007, fullName: 'أحمد جمال' },
      { id: 9, employeeCode: 1009, fullName: 'منى سعيد' },
    ]);
    expect(repository.listByBranch).toHaveBeenCalledWith(3);
  });

  it('resolves an admin-selected branch before listing', async () => {
    const { repository, service } = setup();

    await service.list(admin, { branchId: 4 });

    expect(repository.listByBranch).toHaveBeenCalledWith(4);
  });

  it('allows only an admin to replace the roster', async () => {
    const { repository, service } = setup();

    await expect(service.replace(cashier, {}, { employeeIds: [7] }))
      .rejects.toMatchObject({ code: 'ERP_ROSTER_ADMIN_REQUIRED' });
    expect(repository.replace).not.toHaveBeenCalled();
  });

  it('replaces the roster fully inside the admin-selected branch', async () => {
    const { repository, service } = setup();

    await expect(service.replace(admin, { branchId: 4 }, { employeeIds: [7, 9] }))
      .resolves.toEqual([
        { id: 7, employeeCode: 1007, fullName: 'عضو 7' },
        { id: 9, employeeCode: 1008, fullName: 'عضو 9' },
      ]);
    expect(repository.replace).toHaveBeenCalledWith({
      branchId: 4,
      employeeIds: [7, 9],
      replacedAt: new Date('2026-08-16T12:00:00.000Z'),
    });
  });

  it('rejects a member who is not an active employee of the branch', async () => {
    const { service } = setup('employee_not_in_branch');

    await expect(service.replace(admin, {}, { employeeIds: [42] }))
      .rejects.toMatchObject({ code: 'ERP_ROSTER_EMPLOYEE_INVALID' });
  });
});
