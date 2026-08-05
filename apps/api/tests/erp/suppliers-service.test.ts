import { describe, expect, it, vi } from 'vitest';

import { createSupplierPurchaseService, PurchaseError, type SupplierPurchaseRepository } from '../../src/modules/erp/suppliers/index.js';

const admin = { role: 'admin' as const, accountId: 7 };
const cashier = { role: 'cashier' as const, accountId: 8, employeeId: 3 };
const supplier = { id: 3, branchId: 2, name: 'Nile', phone: null, notes: null, isActive: true, createdAt: new Date(), updatedAt: new Date() };
const purchase = { id: 9, branchId: 2, supplierId: 3, supplierName: 'Nile', status: 'posted' as const, purchaseDate: '2026-08-05', total: '25.00', actingAccountId: 7, actingUsername: 'admin', cancelledAt: null, cancelledByAccountId: null, cancellationReason: null, correctsPurchaseId: null, correctedByPurchaseId: null, createdAt: new Date(), lines: [] };
const repository = (): SupplierPurchaseRepository => ({
  createSupplier: vi.fn(async () => supplier), findSupplierById: vi.fn(async () => supplier), findSupplierByNormalizedName: vi.fn(async () => null),
  listSuppliers: vi.fn(async () => ({ items: [supplier], total: 1 })), updateSupplier: vi.fn(async () => supplier),
  postPurchase: vi.fn(async () => purchase), findPurchase: vi.fn(async () => purchase), listPurchases: vi.fn(async () => ({ items: [purchase], total: 1 })),
  cancelPurchase: vi.fn(async () => ({ ...purchase, status: 'cancelled' as const, cancelledAt: new Date(), cancellationReason: 'خطأ' })),
});
const service = (repo = repository()) => createSupplierPurchaseService({
  repository: repo,
  resolveBranchContext: vi.fn(async (actor, requested) => ({ accountId: actor.accountId, accountRole: actor.role, branchId: requested ?? 2, employeeId: null })),
});

describe('ERP supplier and purchase service', () => {
  it('normalizes and creates branch-scoped suppliers for Admin only', async () => {
    const repo = repository();
    await service(repo).createSupplier(admin, { branchId: 2, name: '  NILE  ', phone: '0100', notes: null });
    expect(vi.mocked(Reflect.get(repo, 'createSupplier'))).toHaveBeenCalledWith(expect.objectContaining({ branchId: 2, name: 'NILE', nameNormalized: expect.stringMatching(/^[a-f0-9]{64}$/) }), 7);
    await expect(service().createSupplier(cashier, { name: 'X' })).rejects.toMatchObject({ code: 'ERP_PURCHASE_ADMIN_REQUIRED' });
  });

  it('calculates exact line totals and posts through one repository transaction', async () => {
    const repo = repository();
    await service(repo).postPurchase(admin, { branchId: 2, idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630', supplierId: 3, purchaseDate: '2026-08-05', lines: [
      { productId: 11, quantity: 2, unitCost: '10.25' }, { productId: 12, quantity: 3, unitCost: '1.50' },
    ] });
    expect(vi.mocked(Reflect.get(repo, 'postPurchase'))).toHaveBeenCalledWith(expect.objectContaining({
      branchId: 2, idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630', idempotencyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), total: '25.00', lines: [
        { productId: 11, quantity: 2, unitCost: '10.25', lineTotal: '20.50' },
        { productId: 12, quantity: 3, unitCost: '1.50', lineTotal: '4.50' },
      ],
    }), 7);
  });

  it('preserves repository cancellation conflicts and branch-safe history filters', async () => {
    const repo = repository();
    vi.mocked(Reflect.get(repo, 'cancelPurchase')).mockRejectedValueOnce(new PurchaseError('PURCHASE_ALREADY_CANCELLED', 'cancelled'));
    await expect(service(repo).cancelPurchase(admin, 9, { branchId: 2, reason: 'خطأ' })).rejects.toMatchObject({ code: 'PURCHASE_ALREADY_CANCELLED' });
    await service(repo).listPurchases(admin, { branchId: 2, supplierId: 3, productId: 11, page: 1, pageSize: 20 });
    expect(vi.mocked(Reflect.get(repo, 'listPurchases'))).toHaveBeenCalledWith(2, expect.objectContaining({ supplierId: 3, productId: 11 }));
  });
});
