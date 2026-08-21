import { describe, expect, it, vi } from 'vitest';

import {
  createFixedAssetService,
  type FixedAssetRecord,
  type FixedAssetRepository,
} from '../../src/modules/erp/fixed-assets/fixed-asset-service.js';

const admin = { accountId: 7, role: 'admin' as const, employeeId: null };
const record: FixedAssetRecord = {
  id: 10, branchId: 2, name: 'كرسي انتظار', quantity: 10, unitPrice: '350.00',
  location: 'الاستقبال', note: '', purchasedOn: '2026-03-01', condition: 'good',
  actingAccountId: 7, actingUsername: 'admin',
  createdAt: new Date('2026-03-01T10:00:00Z'), updatedAt: new Date('2026-03-01T10:00:00Z'),
};
const repository = (): FixedAssetRepository => ({
  create: vi.fn().mockResolvedValue(record),
  findById: vi.fn().mockResolvedValue(record),
  list: vi.fn().mockResolvedValue({ items: [record], total: 1 }),
  update: vi.fn().mockResolvedValue(record),
  remove: vi.fn().mockResolvedValue(true),
});
const resolver = vi.fn().mockResolvedValue({ accountId: 7, branchId: 2 });
const service = (repo: FixedAssetRepository) => createFixedAssetService({
  repository: repo,
  resolveBranchContext: resolver,
});

describe('fixed asset service', () => {
  it('writes the line under the resolved branch and the admin who wrote it', async () => {
    const repo = repository();
    await service(repo).create(admin, { branchId: 2, name: 'كرسي انتظار', quantity: 10 });

    // The repository contract owns methods; the mock intentionally extracts one for call inspection.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(repo.create)).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 2, actingAccountId: 7, name: 'كرسي انتظار' }),
    );
  });

  it('reads and lists a branch register', async () => {
    const repo = repository();
    await expect(service(repo).get(admin, 10, 2)).resolves.toMatchObject({ id: 10 });
    await expect(service(repo).list(admin, { branchId: 2, page: 1, pageSize: 20 }))
      .resolves.toMatchObject({ total: 1 });
  });

  it('edits a line in place, because this register is a note and not a ledger', async () => {
    const repo = repository();
    await service(repo).update(admin, 10, { branchId: 2, name: 'كرسي انتظار', quantity: 8 });

    // The repository contract owns methods; the mock intentionally extracts one for call inspection.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(repo.update)).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ branchId: 2, actingAccountId: 7, quantity: 8 }),
    );
  });

  it('deletes a line outright, since nothing else in the system points at it', async () => {
    const repo = repository();
    await expect(service(repo).remove(admin, 10, 2)).resolves.toBeUndefined();
    // The repository contract owns methods; the mock intentionally extracts one for call inspection.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(repo.remove)).toHaveBeenCalledWith(10, expect.objectContaining({ branchId: 2 }));
  });

  it('hides another branch line as not found on every operation', async () => {
    const repo = repository();
    repo.findById = vi.fn().mockResolvedValue({ ...record, branchId: 9 });
    const scoped = service(repo);

    await expect(scoped.get(admin, 10, 2)).rejects.toMatchObject({ code: 'FIXED_ASSET_NOT_FOUND' });
    await expect(scoped.update(admin, 10, { branchId: 2, name: 'كرسي' }))
      .rejects.toMatchObject({ code: 'FIXED_ASSET_NOT_FOUND' });
    await expect(scoped.remove(admin, 10, 2)).rejects.toMatchObject({ code: 'FIXED_ASSET_NOT_FOUND' });
  });

  it('reports a line that is already gone as not found rather than pretending it deleted one', async () => {
    const repo = repository();
    repo.findById = vi.fn().mockResolvedValue(null);
    await expect(service(repo).remove(admin, 10, 2)).rejects.toMatchObject({
      code: 'FIXED_ASSET_NOT_FOUND',
      message: 'العنصر غير موجود',
    });
  });
});
