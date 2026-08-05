import { describe, expect, it, vi } from 'vitest';

import { createProductStockService, ProductStockError, type ProductStockRepository } from '../../src/modules/erp/stock/index.js';

const admin = { role: 'admin' as const, accountId: 7 };
const cashier = { role: 'cashier' as const, accountId: 8, employeeId: 3 };
const product = {
  id: 11, branchId: 2, name: 'Shampoo', description: null, sellingPrice: '120.00',
  lastPurchaseCost: '70.00', lowStockThreshold: 3, isActive: true, quantity: 5,
  createdAt: new Date('2026-08-01T00:00:00Z'), updatedAt: new Date('2026-08-01T00:00:00Z'),
};

const repository = (): ProductStockRepository => ({
  create: vi.fn(async () => product),
  findById: vi.fn(async () => product),
  findByNormalizedName: vi.fn(async () => null),
  list: vi.fn(async () => ({ items: [product], total: 1 })),
  update: vi.fn(async () => product),
  adjust: vi.fn(async (_id, _branch, input) => ({ product: { ...product, quantity: product.quantity + input.quantityDelta }, movementId: 44 })),
  listMovements: vi.fn(async () => ({ items: [], total: 0 })),
});

const service = (repo = repository()) => createProductStockService({
  repository: repo,
  resolveBranchContext: vi.fn(async (actor, requested) => ({
    accountId: actor.accountId, accountRole: actor.role, branchId: requested ?? 2,
    employeeId: actor.role === 'cashier' ? actor.employeeId : null,
  })),
});

describe('ERP product stock service', () => {
  it('creates a normalized product and opening balance for an Admin', async () => {
    const repo = repository();
    await service(repo).create(admin, {
      branchId: 2, name: '  SHAMPOO  ', sellingPrice: '120.00', lastPurchaseCost: '70.00',
      lowStockThreshold: 3, description: null,
    });
    const create = vi.mocked(Reflect.get(repo, 'create'));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      branchId: 2, name: 'SHAMPOO', nameNormalized: expect.stringMatching(/^[a-f0-9]{64}$/), openingQuantity: 0,
    }), 7);
  });

  it('allows Cashiers to search their branch but not administer products', async () => {
    const result = await service().list(cashier, { page: 1, pageSize: 20 });
    expect(result).toMatchObject({ total: 1 });
    expect(result.items[0]).not.toHaveProperty('lastPurchaseCost');
    expect(result.items[0]).not.toHaveProperty('lowStockThreshold');
    await expect(service().update(cashier, 11, { name: 'X' })).rejects.toMatchObject({ code: 'ERP_STOCK_ADMIN_REQUIRED' });
  });

  it('rejects an adjustment that would make stock negative', async () => {
    const repo = repository();
    const adjust = vi.mocked(Reflect.get(repo, 'adjust'));
    adjust.mockRejectedValue(new ProductStockError('INSUFFICIENT_STOCK', 'insufficient'));
    await expect(service(repo).adjust(admin, 11, { branchId: 2, quantityDelta: -6, reason: 'damage' })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });
});
