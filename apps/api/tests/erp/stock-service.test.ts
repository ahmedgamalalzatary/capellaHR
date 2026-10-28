import { describe, expect, it, vi } from 'vitest';

import { createProductStockService, ProductStockError, type ProductStockRepository } from '../../src/modules/erp/stock/index.js';
import { matchKeyFor } from '../../src/modules/erp/catalog/index.js';

const admin = { role: 'admin' as const, accountId: 7 };
const cashier = { role: 'cashier' as const, accountId: 8, branchId: 2 };
const product = {
  id: 11, branchId: 2, name: 'Shampoo', description: null, sellingPrice: '120.00',
  lastPurchaseCost: '70.00', lowStockThreshold: 3, isActive: true, awaitingFirstStock: false,
  quantity: 5, barcode: null,
  createdAt: new Date('2026-08-01T00:00:00Z'), updatedAt: new Date('2026-08-01T00:00:00Z'),
};

const repository = (): ProductStockRepository => ({
  listBatches: vi.fn(async () => []),
  updateBatchExpiry: vi.fn(async () => []),
  create: vi.fn(async () => product),
  findById: vi.fn(async () => product),
  findByNormalizedName: vi.fn(async () => null),
  findByBarcode: vi.fn(async () => null),
  list: vi.fn(async () => ({ items: [product], total: 1 })),
  update: vi.fn(async () => product),
  activate: vi.fn(async () => ({ ...product, isActive: true, awaitingFirstStock: false })),
  latestIncomingPrice: vi.fn(async () => null),
  adjust: vi.fn(async (_id, _branch, input) => ({ product: { ...product, quantity: product.quantity + input.quantityDelta }, movementId: 44 })),
  listMovements: vi.fn(async () => ({ items: [], total: 0 })),
});

const service = (repo = repository()) => createProductStockService({
  repository: repo,
  resolveBranchContext: vi.fn(async (actor, requested) => ({
    accountId: actor.accountId, accountRole: actor.role, branchId: requested ?? 2,
    employeeId: null,
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

  it('lets a Cashier administer the products of their own branch', async () => {
    // The Cashier owns the products screen, so they read and write the same
    // record an Admin does — the resolver still pins the branch.
    const result = await service().list(cashier, { page: 1, pageSize: 20 });
    expect(result).toMatchObject({ total: 1 });
    expect(result.items[0]).toMatchObject({ lastPurchaseCost: '70.00', lowStockThreshold: 3 });

    await expect(service().update(cashier, 11, { name: 'X' })).resolves.toMatchObject({ id: 11 });
    await expect(service().listMovements(cashier, { page: 1, pageSize: 20 }))
      .resolves.toMatchObject({ total: 0 });
  });

  it('refuses a Cashier setting a commission percentage on a product', async () => {
    // The screen hides the field, but the API is the real door: a cashier who
    // could set 100% would hand the whole line to the assigned employee.
    const repo = repository();
    await expect(service(repo).update(cashier, 11, { commissionPercent: '100.00' }))
      .rejects.toMatchObject({ code: 'PRODUCT_COMMISSION_ADMIN_REQUIRED' });
    await expect(service(repo).create(cashier, {
      branchId: 2, name: 'Shampoo', sellingPrice: '120.00', lastPurchaseCost: '70.00',
      lowStockThreshold: 3, description: null, commissionPercent: '25.00',
    })).rejects.toMatchObject({ code: 'PRODUCT_COMMISSION_ADMIN_REQUIRED' });
    expect(vi.mocked(Reflect.get(repo, 'create'))).not.toHaveBeenCalled();
  });

  it('refuses a Cashier zeroing a commission percentage an Admin set', async () => {
    // Zero is a rate too: on update it would quietly strip the assigned
    // employee's earnings, so the field is refused whatever it carries.
    await expect(service().update(cashier, 11, { commissionPercent: '0.00' }))
      .rejects.toMatchObject({ code: 'PRODUCT_COMMISSION_ADMIN_REQUIRED' });
  });

  it('lets a Cashier create a product without touching the commission percentage', async () => {
    const repo = repository();
    await expect(service(repo).create(cashier, {
      branchId: 2, name: 'Shampoo', sellingPrice: '120.00', lastPurchaseCost: '70.00',
      lowStockThreshold: 3, description: null,
    })).resolves.toMatchObject({ id: 11 });
    expect(vi.mocked(Reflect.get(repo, 'create')))
      .toHaveBeenCalledWith(expect.objectContaining({ commissionPercent: '0.00' }), 8);
  });

  it('lets a Cashier create a product with a zero commission percentage', async () => {
    // The counter sends the field it holds, and a new product earns nothing
    // until an Admin sets a rate — that is the only rate a Cashier may write.
    const repo = repository();
    await expect(service(repo).create(cashier, {
      branchId: 2, name: 'Shampoo', sellingPrice: '120.00', lastPurchaseCost: '70.00',
      lowStockThreshold: 3, description: null, commissionPercent: '0.00',
    })).resolves.toMatchObject({ id: 11 });
  });

  it('refuses a Cashier adjusting stock', async () => {
    // Stock adjustment is how a cashier would create goods out of nothing.
    const repo = repository();
    await expect(service(repo).adjust(cashier, 11, { quantityDelta: 1, reason: 'count_correction' }))
      .rejects.toMatchObject({ code: 'PRODUCT_ADJUSTMENT_ADMIN_REQUIRED' });
    expect(vi.mocked(Reflect.get(repo, 'adjust'))).not.toHaveBeenCalled();
  });

  it('stores the cross-branch match key on create and on rename', async () => {
    // Transfers find and lock the receiving product by this key, so it has to be
    // written with the row rather than recomputed from names at query time.
    const repo = repository();
    await service(repo).create(admin, {
      branchId: 2, name: '  SHAMPOO  ', sellingPrice: '120.00', lastPurchaseCost: '70.00',
      lowStockThreshold: 3, description: null,
    });
    expect(vi.mocked(Reflect.get(repo, 'create'))).toHaveBeenCalledWith(
      expect.objectContaining({ matchKey: matchKeyFor('SHAMPOO') }), 7,
    );

    const update = vi.mocked(Reflect.get(repo, 'update'));
    await service(repo).update(admin, 11, { name: 'شَامْبُو' });
    expect(update).toHaveBeenCalledWith(
      11, 2, expect.objectContaining({ matchKey: matchKeyFor('شَامْبُو') }), 7,
    );
  });

  it('does not touch the match key when a rename is absent', async () => {
    const repo = repository();
    const update = vi.mocked(Reflect.get(repo, 'update'));
    await service(repo).update(admin, 11, { sellingPrice: '130.00' });
    expect(update).toHaveBeenCalledWith(11, 2, { sellingPrice: '130.00' }, 7);
  });

  it('refuses a Cashier activating a product', async () => {
    // Activation sets the price the branch will sell at; that is an Admin's move.
    const repo = repository();
    await expect(service(repo).activate(cashier, 11, { sellingPrice: '120.00' }))
      .rejects.toMatchObject({ code: 'PRODUCT_ACTIVATION_ADMIN_REQUIRED' });
    expect(vi.mocked(Reflect.get(repo, 'activate'))).not.toHaveBeenCalled();
  });

  it('activates an awaiting product with the price the Admin typed', async () => {
    const repo = repository();
    await service(repo).activate(admin, 11, { sellingPrice: '150.00' });
    expect(vi.mocked(Reflect.get(repo, 'activate'))).toHaveBeenCalledWith(11, 2, '150.00', 7);
  });

  it('clears the awaiting flag when an awaiting product is deactivated', async () => {
    // Otherwise the row would stay "awaiting" and the list would keep offering
    // an activation that the Admin never asked for.
    const repo = repository();
    await service(repo).update(admin, 11, { isActive: false });
    expect(vi.mocked(Reflect.get(repo, 'update'))).toHaveBeenCalledWith(
      11, 2, { isActive: false, awaitingFirstStock: false }, 7,
    );
  });

  it('suggests the price the sending branch sells the product at', async () => {
    const repo = repository();
    vi.mocked(Reflect.get(repo, 'latestIncomingPrice')).mockResolvedValue('88.00');
    await expect(service(repo).activationPrice(admin, 11, {}))
      .resolves.toBe('88.00');
    expect(vi.mocked(Reflect.get(repo, 'latestIncomingPrice'))).toHaveBeenCalledWith(11, 2);
  });

  it('rejects an adjustment that would make stock negative', async () => {
    const repo = repository();
    const adjust = vi.mocked(Reflect.get(repo, 'adjust'));
    adjust.mockRejectedValue(new ProductStockError('INSUFFICIENT_STOCK', 'insufficient'));
    await expect(service(repo).adjust(admin, 11, { branchId: 2, quantityDelta: -6, reason: 'damage' })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('keeps the supplier code the admin scanned off the box', async () => {
    const repo = repository();
    await service(repo).create(admin, {
      branchId: 2, name: 'Shampoo', sellingPrice: '120.00', lastPurchaseCost: '70.00',
      lowStockThreshold: 3, description: null, barcode: '6221031492108',
    });
    expect(vi.mocked(Reflect.get(repo, 'create')))
      .toHaveBeenCalledWith(expect.objectContaining({ barcode: '6221031492108' }), 7);
  });

  it('refuses a barcode that already points at another product in the branch', async () => {
    const repo = repository();
    vi.mocked(Reflect.get(repo, 'findByBarcode')).mockResolvedValue({ ...product, id: 99 });
    await expect(service(repo).create(admin, {
      branchId: 2, name: 'Other', sellingPrice: '1', lastPurchaseCost: '0',
      lowStockThreshold: 0, description: null, barcode: '6221031492108',
    })).rejects.toMatchObject({ code: 'PRODUCT_BARCODE_EXISTS', existingId: 99 });
  });

  it('finds a product by the code the till scanned', async () => {
    const repo = repository();
    vi.mocked(Reflect.get(repo, 'findByBarcode')).mockResolvedValue({ ...product, barcode: '2000000000114' });
    await expect(service(repo).findByBarcode(cashier, { code: '2000000000114' }))
      .resolves.toMatchObject({ id: 11 });
    expect(vi.mocked(Reflect.get(repo, 'findByBarcode'))).toHaveBeenCalledWith(2, '2000000000114');
  });

  it('reports an unknown code rather than guessing', async () => {
    await expect(service().findByBarcode(cashier, { code: '9999999999999' }))
      .rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });

  it('prints an in-store code for a product that arrived without one', async () => {
    const repo = repository();
    vi.mocked(Reflect.get(repo, 'update')).mockImplementation(async (_id, _branch, changes) => (
      { ...product, ...changes }
    ));
    await expect(service(repo).generateBarcode(admin, 11, { branchId: 2 }))
      .resolves.toMatchObject({ barcode: '2000000000114' });
  });

  it('leaves an existing code alone, so reprinting a sticker never changes it', async () => {
    const repo = repository();
    const existing = { ...product, barcode: '6221031492108' };
    vi.mocked(Reflect.get(repo, 'findById')).mockResolvedValue(existing);
    await expect(service(repo).generateBarcode(admin, 11, { branchId: 2 }))
      .resolves.toMatchObject({ barcode: '6221031492108' });
    expect(vi.mocked(Reflect.get(repo, 'update'))).not.toHaveBeenCalled();
  });

  it('refuses to generate a code that already belongs to another product', async () => {
    // The in-store code is derived from the product id, but a supplier sticker may already
    // carry those digits. Printing it would point one code at two products on the shelf.
    const repo = repository();
    vi.mocked(Reflect.get(repo, 'findByBarcode')).mockResolvedValue({ ...product, id: 99, barcode: '2000000000114' });
    await expect(service(repo).generateBarcode(admin, 11, { branchId: 2 }))
      .rejects.toMatchObject({ code: 'PRODUCT_BARCODE_EXISTS', existingId: 99 });
    expect(vi.mocked(Reflect.get(repo, 'update'))).not.toHaveBeenCalled();
  });

  it('reports a code taken between the check and the write as a conflict, not a crash', async () => {
    const repo = repository();
    const dupError = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    vi.mocked(Reflect.get(repo, 'update')).mockRejectedValueOnce(dupError);
    vi.mocked(Reflect.get(repo, 'findByBarcode'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...product, id: 99, barcode: '2000000000114' });
    await expect(service(repo).generateBarcode(admin, 11, { branchId: 2 }))
      .rejects.toMatchObject({ code: 'PRODUCT_BARCODE_EXISTS', existingId: 99 });
  });

  it('does not blame the barcode for a collision no product holds', async () => {
    // The write failed on some other index. Saying "barcode already used" would send the
    // admin looking for a sticker that is not on any shelf.
    const repo = repository();
    const dupError = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    vi.mocked(Reflect.get(repo, 'update')).mockRejectedValueOnce(dupError);
    vi.mocked(Reflect.get(repo, 'findByBarcode')).mockResolvedValue(null);
    await expect(service(repo).generateBarcode(admin, 11, { branchId: 2 }))
      .rejects.toBe(dupError);
  });

  it('distinguishes a duplicate name from a duplicate barcode', async () => {
    const repo = repository();
    // Pre-check passes (race: the duplicate was inserted after we checked)
    vi.mocked(Reflect.get(repo, 'findByNormalizedName')).mockResolvedValueOnce(null);
    vi.mocked(Reflect.get(repo, 'findByBarcode')).mockResolvedValueOnce(null);
    // Insert fails with ER_DUP_ENTRY on the name unique index
    const dupError = Object.assign(
      new Error('Failed query: INSERT INTO erp_products (name, barcode, ...) VALUES ...'),
      { code: 'ER_DUP_ENTRY' }
    );
    vi.mocked(Reflect.get(repo, 'create')).mockRejectedValueOnce(dupError);
    // Post-failure lookups find the winner
    const existing = { ...product, id: 99, name: 'SHAMPOO' };
    vi.mocked(Reflect.get(repo, 'findByNormalizedName')).mockResolvedValueOnce(existing);
    vi.mocked(Reflect.get(repo, 'findByBarcode')).mockResolvedValueOnce(null);
    
    await expect(service(repo).create(admin, {
      branchId: 2, name: 'SHAMPOO', sellingPrice: '1', lastPurchaseCost: '0',
      lowStockThreshold: 0, description: null, barcode: '1234567890123',
    })).rejects.toMatchObject({ code: 'PRODUCT_NAME_EXISTS', existingId: 99 });
  });
});
