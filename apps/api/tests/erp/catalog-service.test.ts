import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { ErpAccountIdentity, ErpBranchContextResolver } from '../../src/modules/erp/index.js';
import {
  CatalogError,
  createCategoryService,
  createServiceCatalogService,
  isDuplicateEntryError,
  type CategoryRecord,
  type CategoryRepository,
  type CommissionOverrideRecord,
  type ServiceRecord,
  type ServiceRepository,
} from '../../src/modules/erp/catalog/index.js';
import type { ErpEmployeeCapability } from '../../src/modules/erp/index.js';

const ADMIN: ErpAccountIdentity = { role: 'admin', accountId: 1 };
const CASHIER: ErpAccountIdentity = { role: 'cashier', accountId: 9, branchId: 4 };

/** Stands in for the real resolver, which is covered by its own tests. */
const resolverFor = (branchId: number): ErpBranchContextResolver => async (actor) => ({
  accountId: actor.accountId,
  accountRole: actor.role,
  branchId,
    employeeId: null,
});

const category = (overrides: Partial<CategoryRecord> = {}): CategoryRecord => ({
  id: 1,
  branchId: 1,
  type: 'service',
  name: 'شعر',
  isActive: true,
  hasEverBeenReferenced: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const service = (overrides: Partial<ServiceRecord> = {}): ServiceRecord => ({
  id: 1,
  branchId: 1,
  categoryId: 1,
  name: 'صبغة',
  description: null,
  price: '150.00',
  commissionPercent: '10.00',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const override = (overrides: Partial<CommissionOverrideRecord> = {}): CommissionOverrideRecord => ({
  id: 1,
  serviceId: 1,
  employeeId: 4,
  commissionPercent: '20.00',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const duplicateEntryError = () => Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });

const categoryRepository = (
  overrides: Partial<CategoryRepository> = {},
): CategoryRepository => ({
  create: vi.fn(async (input: Parameters<CategoryRepository['create']>[0]) => category(input)),
  findById: vi.fn(async () => category()),
  findByNormalizedName: vi.fn(async () => null),
  list: vi.fn(async () => ({ items: [], total: 0 })),
  update: vi.fn(async (id: number, branchId: number) => category({ id, branchId })),
  delete: vi.fn(async () => 'deleted' as const),
  ...overrides,
});

const serviceRepository = (overrides: Partial<ServiceRepository> = {}): ServiceRepository => ({
  create: vi.fn(async (input: Parameters<ServiceRepository['create']>[0]) => service(input)),
  findById: vi.fn(async () => service()),
  findByNormalizedName: vi.fn(async () => null),
  list: vi.fn(async () => ({ items: [], total: 0 })),
  update: vi.fn(async (id: number, branchId: number) => service({ id, branchId })),
  listOverrides: vi.fn(async () => []),
  setOverride: vi.fn(async (
    serviceId: number,
    employeeId: number,
    commissionPercent: string,
  ) => override({ serviceId, employeeId, commissionPercent })),
  deleteOverride: vi.fn(async () => true),
  ...overrides,
});

const employees = (branchId: number | null = 1) => ({
  findActiveById: vi.fn(async (id: number) => (
    branchId === null ? null : { id, employeeCode: 100, fullName: 'موظفة', branchId }
  )),
}) as unknown as ErpEmployeeCapability;

const categories = (repository: CategoryRepository, branchId = 1) => createCategoryService({
  repository,
  resolveBranchContext: resolverFor(branchId),
});

const services = (
  repository: ServiceRepository,
  options: { categories?: CategoryRepository; branchId?: number; employeeBranchId?: number | null } = {},
) => createServiceCatalogService({
  repository,
  categories: options.categories ?? categoryRepository(),
  employees: employees(options.employeeBranchId === undefined ? 1 : options.employeeBranchId),
  resolveBranchContext: resolverFor(options.branchId ?? 1),
});

describe('ERP category service', () => {
  it('does not inspect primitive duplicate-error causes', () => {
    expect(isDuplicateEntryError({ cause: 'duplicate' })).toBe(false);
    expect(isDuplicateEntryError({ cause: 1 })).toBe(false);
    expect(isDuplicateEntryError({ cause: { code: 'ER_DUP_ENTRY' } })).toBe(true);
  });

  it('trims the name and takes the branch from the resolver, not the caller', async () => {
    const create = vi.fn(async (input: Parameters<CategoryRepository['create']>[0]) => category(input));
    await categories(categoryRepository({ create }), 7)
      .create(ADMIN, { name: '  شعر  ', type: 'service', branchId: 999 });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ branchId: 7, name: 'شعر', type: 'service' }));
  });

  it('lets a cashier administer the catalog of their own branch', async () => {
    // The Cashier owns the catalog screen; the resolver still pins the branch.
    const create = vi.fn(async (input: Parameters<CategoryRepository['create']>[0]) => category(input));
    await categories(categoryRepository({ create }), 4)
      .create(CASHIER, { name: 'شعر', type: 'service', branchId: 999 });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ branchId: 4, name: 'شعر' }));
  });

  it('lets a cashier browse categories without naming a branch', async () => {
    const list = vi.fn(async () => ({ items: [], total: 0 }));
    await categories(categoryRepository({ list }), 5).list(CASHIER, { page: 1, pageSize: 20 });

    expect(list).toHaveBeenCalledWith(5, expect.objectContaining({ page: 1 }));
  });

  it('rejects a duplicate category name within the branch', async () => {
    const existing = vi.fn(async () => category({ id: 42 }));
    const repository = categoryRepository({
      findByNormalizedName: existing as unknown as CategoryRepository['findByNormalizedName'],
    });

    await expect(categories(repository).create(ADMIN, { name: 'شعر', type: 'service' }))
      .rejects.toMatchObject({ code: 'CATEGORY_NAME_EXISTS', existingId: 42 });
  });

  it('translates a lost uniqueness race into the same conflict', async () => {
    const findByNormalizedName = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(category({ id: 55 }));
    const repository = categoryRepository({
      findByNormalizedName: findByNormalizedName as unknown as CategoryRepository['findByNormalizedName'],
      create: vi.fn(async () => { throw duplicateEntryError(); }),
    });

    await expect(categories(repository).create(ADMIN, { name: 'شعر', type: 'service' }))
      .rejects.toMatchObject({ code: 'CATEGORY_NAME_EXISTS', existingId: 55 });
  });

  it('hides a category belonging to another branch instead of forbidding it', async () => {
    const repository = categoryRepository({ findById: vi.fn(async () => category({ branchId: 2 })) });

    await expect(categories(repository, 1).get(ADMIN, 1))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });

  it('deactivates a category instead of requiring its removal', async () => {
    const update = vi.fn(async () => category({ isActive: false }));
    const result = await categories(categoryRepository({ update })).update(ADMIN, 1, { isActive: false });

    expect(update).toHaveBeenCalledWith(1, 1, { isActive: false });
    expect(result.isActive).toBe(false);
  });

  it('deletes a category that nothing has ever referenced', async () => {
    const remove = vi.fn(async () => 'deleted' as const);
    await categories(categoryRepository({ delete: remove })).remove(ADMIN, 1);

    expect(remove).toHaveBeenCalledWith(1, 1);
  });

  it('refuses to delete a category that history depends on', async () => {
    // Deleting it would orphan the services (and later expenses) that point at it.
    const repository = categoryRepository({ delete: vi.fn(async () => 'referenced' as const) });

    await expect(categories(repository).remove(ADMIN, 1))
      .rejects.toMatchObject({ code: 'CATEGORY_IN_USE' });
  });

  it('reports deleting an unknown category as missing', async () => {
    const repository = categoryRepository({ delete: vi.fn(async () => 'missing' as const) });

    await expect(categories(repository).remove(ADMIN, 1))
      .rejects.toEqual(expect.any(CatalogError));
  });
});

describe('ERP service catalog service', () => {
  it('uses an atomic upsert for commission overrides', () => {
    const source = readFileSync(resolve('src/modules/erp/catalog/services-repository.ts'), 'utf8');
    expect(source).toContain('.onDuplicateKeyUpdate({');
  });

  it('stores the exact price and commission the contract normalized', async () => {
    const create = vi.fn(async (input: Parameters<ServiceRepository['create']>[0]) => service(input));
    await services(serviceRepository({ create })).create(ADMIN, {
      name: '  صبغة  ',
      categoryId: 1,
      price: '150.00',
      commissionPercent: '12.50',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'صبغة', price: '150.00', commissionPercent: '12.50', branchId: 1,
    }));
  });

  it('creates an open-priced service with a null catalog price', async () => {
    const create = vi.fn(async (input: Parameters<ServiceRepository['create']>[0]) => service(input));
    await services(serviceRepository({ create })).create(ADMIN, {
      name: 'بروتين شعر',
      categoryId: 1,
      price: null,
      commissionPercent: '10.00',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ price: null }));
  });

  it('converts fixed and open pricing only through delete then set transitions', async () => {
    const update = vi.fn(async (_id: number, _branchId: number, changes: Parameters<ServiceRepository['update']>[2]) => (
      service({ price: changes.price === undefined ? '150.00' : changes.price })
    ));
    const fixedCatalog = services(serviceRepository({ update }));

    await expect(fixedCatalog.update(ADMIN, 1, { price: '175.00' }))
      .rejects.toMatchObject({ code: 'SERVICE_PRICE_LOCKED' });
    await expect(fixedCatalog.update(ADMIN, 1, { price: null }))
      .resolves.toMatchObject({ price: null });

    const openCatalog = services(serviceRepository({
      findById: vi.fn(async () => service({ price: null })),
      update,
    }));
    await expect(openCatalog.update(ADMIN, 1, { price: '175.00' }))
      .resolves.toMatchObject({ price: '175.00' });
  });

  it('maps an atomic repository price race to the locked-price conflict', async () => {
    const repository = serviceRepository({
      findById: vi.fn(async () => service({ price: null })),
      update: vi.fn(async () => 'price_locked' as const),
    });

    await expect(services(repository).update(ADMIN, 1, { price: '175.00' }))
      .rejects.toMatchObject({ code: 'SERVICE_PRICE_LOCKED' });
  });

  it('lets a cashier administer services of their own branch', async () => {
    const created = await services(serviceRepository())
      .create(CASHIER, { name: 'صبغة', categoryId: 1, price: '150.00', commissionPercent: '0.00' });

    expect(created).toMatchObject({ name: 'صبغة' });
  });

  it('rejects a category that belongs to another branch', async () => {
    const other = categoryRepository({ findById: vi.fn(async () => category({ branchId: 2 })) });

    await expect(services(serviceRepository(), { categories: other })
      .create(ADMIN, { name: 'صبغة', categoryId: 1, price: '150.00', commissionPercent: '0.00' }))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });

  it('rejects a category stored with any type other than service', async () => {
    // Only stale data can reach this: the catalog offers no other type.
    const expense = categoryRepository({
      findById: vi.fn(async () => category({ type: 'expense' as never })),
    });

    await expect(services(serviceRepository(), { categories: expense })
      .create(ADMIN, { name: 'صبغة', categoryId: 1, price: '150.00', commissionPercent: '0.00' }))
      .rejects.toMatchObject({ code: 'CATEGORY_TYPE_INVALID' });
  });

  it('rejects a deactivated category for a new service', async () => {
    const retired = categoryRepository({ findById: vi.fn(async () => category({ isActive: false })) });

    await expect(services(serviceRepository(), { categories: retired })
      .create(ADMIN, { name: 'صبغة', categoryId: 1, price: '150.00', commissionPercent: '0.00' }))
      .rejects.toMatchObject({ code: 'CATEGORY_INACTIVE' });
  });

  it('rejects a duplicate service name inside the branch', async () => {
    const repository = serviceRepository({ findByNormalizedName: vi.fn(async () => service({ id: 42 })) });

    await expect(services(repository)
      .create(ADMIN, { name: 'صبغة', categoryId: 1, price: '150.00', commissionPercent: '0.00' }))
      .rejects.toMatchObject({ code: 'SERVICE_NAME_EXISTS', existingId: 42 });
  });

  it('lets a service keep its own name on update but not take another service\'s', async () => {
    const own = service({ id: 3 });
    const keeps = services(serviceRepository({
      findById: vi.fn(async () => own),
      findByNormalizedName: vi.fn(async () => own),
      update: vi.fn(async () => own),
    }));
    await expect(keeps.update(ADMIN, 3, { name: 'صبغة' })).resolves.toMatchObject({ id: 3 });

    const taken = services(serviceRepository({
      findById: vi.fn(async () => own),
      findByNormalizedName: vi.fn(async () => service({ id: 8 })),
    }));
    await expect(taken.update(ADMIN, 3, { name: 'صبغة' }))
      .rejects.toMatchObject({ code: 'SERVICE_NAME_EXISTS', existingId: 8 });
  });

  it('retires a service by deactivating it and offers no way to delete it', async () => {
    // An invoice line points back at the service it snapshotted, so the row must
    // stay resolvable forever.
    const catalog = services(serviceRepository());

    expect('remove' in catalog).toBe(false);
    expect('delete' in catalog).toBe(false);
  });

  it('hides another branch\'s service from reads and updates', async () => {
    const repository = serviceRepository({ findById: vi.fn(async () => service({ branchId: 2 })) });

    await expect(services(repository, { branchId: 1 }).get(ADMIN, 1))
      .rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND' });
    await expect(services(repository, { branchId: 1 }).update(ADMIN, 1, { price: '9.00' }))
      .rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND' });
  });

  it('scopes browsing to the resolved branch', async () => {
    const list = vi.fn(async () => ({ items: [], total: 0 }));
    await services(serviceRepository({ list }), { branchId: 7 })
      .list(CASHIER, { page: 1, pageSize: 20 });

    expect(list).toHaveBeenCalledWith(7, expect.objectContaining({ page: 1 }));
  });

  it('sets a per-employee commission override for an employee of the same branch', async () => {
    const setOverride = vi.fn(async () => override());
    await services(serviceRepository({ setOverride }))
      .setCommissionOverride(ADMIN, 1, { employeeId: 4, commissionPercent: '20.00' });

    expect(setOverride).toHaveBeenCalledWith(1, 4, '20.00');
  });

  it('refuses an override for an employee outside the service branch', async () => {
    await expect(services(serviceRepository(), { employeeBranchId: 2 })
      .setCommissionOverride(ADMIN, 1, { employeeId: 4, commissionPercent: '20.00' }))
      .rejects.toMatchObject({ code: 'CATALOG_EMPLOYEE_NOT_FOUND' });
  });

  it('refuses an override for a deleted or inactive employee', async () => {
    await expect(services(serviceRepository(), { employeeBranchId: null })
      .setCommissionOverride(ADMIN, 1, { employeeId: 4, commissionPercent: '20.00' }))
      .rejects.toMatchObject({ code: 'CATALOG_EMPLOYEE_NOT_FOUND' });
  });

  it('refuses override administration by a cashier', async () => {
    await expect(services(serviceRepository()).listCommissionOverrides(CASHIER, 1))
      .rejects.toMatchObject({ code: 'ERP_CATALOG_ADMIN_REQUIRED' });
    await expect(services(serviceRepository())
      .setCommissionOverride(CASHIER, 1, { employeeId: 4, commissionPercent: '20.00' }))
      .rejects.toMatchObject({ code: 'ERP_CATALOG_ADMIN_REQUIRED' });
  });

  it('reports removing a missing override rather than pretending it succeeded', async () => {
    const repository = serviceRepository({ deleteOverride: vi.fn(async () => false) });

    await expect(services(repository).removeCommissionOverride(ADMIN, 1, 4))
      .rejects.toMatchObject({ code: 'COMMISSION_OVERRIDE_NOT_FOUND' });
  });

  it('lists overrides only for a service inside the acting branch', async () => {
    const repository = serviceRepository({ findById: vi.fn(async () => service({ branchId: 2 })) });

    await expect(services(repository, { branchId: 1 }).listCommissionOverrides(ADMIN, 1))
      .rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND' });
  });
});
