import { describe, expect, it, vi } from 'vitest';

import { ConsumablesError, createConsumablesService } from '../../src/modules/erp/consumables/consumables-service.js';

const admin = { accountId: 1, role: 'admin' as const };
const cashier = { accountId: 2, role: 'cashier' as const, branchId: 3 };
const context = (actor: typeof admin | typeof cashier) => Promise.resolve({
  accountId: actor.accountId,
  accountRole: actor.role,
  branchId: actor.role === 'admin' ? 3 : actor.branchId,
  employeeId: null,
});

const repository = () => ({
  configure: vi.fn().mockResolvedValue({ productId: 9, branchId: 3, unit: 'ml', packageSize: '150.000', quantity: '0.000' }),
  transfer: vi.fn().mockResolvedValue({ productId: 9, sellableQuantity: 8, consumableQuantity: '300.000' }),
  listBalances: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  listServices: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  complete: vi.fn().mockResolvedValue([]),
  correct: vi.fn().mockResolvedValue({ id: 11 }),
});

describe('consumables service', () => {
  it('allows only admins to configure products and transfer packages', async () => {
    const repo = repository();
    const service = createConsumablesService({ repository: repo, resolveBranchContext: context });
    await service.configure(admin, 9, { unit: 'ml', packageSize: '150.000', branchId: 3 });
    await service.transfer(admin, 9, { direction: 'reserve', packages: 2, branchId: 3 });
    expect(repo.configure).toHaveBeenCalledWith(9, 3, 'ml', '150.000', 1);
    await expect(service.transfer(cashier, 9, { direction: 'reserve', packages: 1 }))
      .rejects.toMatchObject({ code: 'CONSUMABLES_ADMIN_REQUIRED' });
  });

  it('lets a cashier complete services only through their branch context', async () => {
    const repo = repository();
    const service = createConsumablesService({ repository: repo, resolveBranchContext: context });
    await service.complete(cashier, {
      serviceQueueEntryIds: [11, 12], usages: [{ productId: 9, quantity: '20.000' }], noConsumablesConfirmed: false,
    });
    expect(repo.complete).toHaveBeenCalledWith({
      branchId: 3, accountId: 2, accountRole: 'cashier',
      serviceQueueEntryIds: [11, 12], usages: [{ productId: 9, quantity: '20.000' }],
    });
  });

  it('refuses service completion without consumables or an explicit no-consumables confirmation', async () => {
    const repo = repository();
    const service = createConsumablesService({ repository: repo, resolveBranchContext: context });
    await expect(service.complete(cashier, {
      serviceQueueEntryIds: [11], usages: [], noConsumablesConfirmed: false,
    })).rejects.toMatchObject({ code: 'CONSUMABLE_USAGE_DECISION_REQUIRED' });
    expect(repo.complete).not.toHaveBeenCalled();
  });

  it('scopes a cashier service list to their own account while admins may inspect the branch', async () => {
    const repo = repository();
    const service = createConsumablesService({ repository: repo, resolveBranchContext: context });
    await service.listServices(cashier, { status: 'pending', page: 1, pageSize: 20 });
    expect(repo.listServices).toHaveBeenCalledWith(3, expect.objectContaining({ status: 'pending' }), 2);
    await service.listServices(admin, { branchId: 3, page: 1, pageSize: 20 });
    expect(repo.listServices).toHaveBeenLastCalledWith(3, expect.anything(), undefined);
  });

  it('requires an admin to correct a service after its shift closed', async () => {
    const repo = repository();
    repo.correct.mockRejectedValueOnce(new ConsumablesError('CONSUMABLE_SHIFT_CLOSED', 'closed'));
    const service = createConsumablesService({ repository: repo, resolveBranchContext: context });
    await expect(service.correct(cashier, 11, { reason: 'fix', usages: [] }))
      .rejects.toMatchObject({ code: 'CONSUMABLE_SHIFT_CLOSED' });
    await service.correct(admin, 11, { reason: 'fix', usages: [], branchId: 3 });
    expect(repo.correct).toHaveBeenLastCalledWith(expect.objectContaining({ accountRole: 'admin' }));
  });
});
