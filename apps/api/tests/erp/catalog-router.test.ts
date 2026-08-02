import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  createErpBranchContextResolver,
  type ErpBranchCapability,
  type ErpEmployeeCapability,
} from '../../src/modules/erp/index.js';
import {
  createCategoryService,
  createErpCategoriesRouter,
  createErpServicesRouter,
  createServiceCatalogService,
  type CategoryRecord,
  type CategoryRepository,
  type CommissionOverrideRecord,
  type ServiceRecord,
  type ServiceRepository,
} from '../../src/modules/erp/catalog/index.js';

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

const overrideRecord = (
  overrides: Partial<CommissionOverrideRecord> = {},
): CommissionOverrideRecord => ({
  id: 1,
  serviceId: 1,
  employeeId: 4,
  commissionPercent: '20.00',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// Branch 1 belongs to the cashier's employee; branch 2 exists but is not theirs.
const branches = {
  findById: vi.fn(async (id: number) => (id === 1 || id === 2 ? { id, name: `فرع ${id}` } : null)),
} as unknown as ErpBranchCapability;

const employees = {
  findActiveById: vi.fn(async (id: number) => (
    id === 4 ? { id: 4, employeeCode: 100, fullName: 'كاشير', branchId: 1 } : null
  )),
} as unknown as ErpEmployeeCapability;

const categoryRepository = (overrides: Partial<CategoryRepository> = {}): CategoryRepository => ({
  create: vi.fn(async (input: Parameters<CategoryRepository['create']>[0]) => category(input)),
  findById: vi.fn(async () => category()),
  findByNormalizedName: vi.fn(async () => null),
  list: vi.fn(async () => ({ items: [category()], total: 1 })),
  update: vi.fn(async () => category()),
  delete: vi.fn(async () => 'deleted' as const),
  ...overrides,
});

const serviceRepository = (overrides: Partial<ServiceRepository> = {}): ServiceRepository => ({
  create: vi.fn(async (input: Parameters<ServiceRepository['create']>[0]) => service(input)),
  findById: vi.fn(async () => service()),
  findByNormalizedName: vi.fn(async () => null),
  list: vi.fn(async () => ({
    items: [{ ...service(), categoryName: 'شعر', categoryIsActive: true }],
    total: 1,
  })),
  update: vi.fn(async () => service()),
  listOverrides: vi.fn(async () => [overrideRecord()]),
  setOverride: vi.fn(async () => overrideRecord()),
  deleteOverride: vi.fn(async () => true),
  ...overrides,
});

const ADMIN = { type: 'admin', accountId: 1 };
const CASHIER = { type: 'cashier', accountId: 2, employeeId: 4 };

/** Real services and the real resolver over fake repositories, so the HTTP layer
 *  exercises the actual branch and role rules rather than a stubbed service. */
const makeApp = (
  actor: unknown,
  repositories: { categories?: CategoryRepository; services?: ServiceRepository } = {},
) => {
  const categories = repositories.categories ?? categoryRepository();
  const resolveBranchContext = createErpBranchContextResolver({ branches, employees });
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => { response.locals.actor = actor; next(); });
  app.use('/api/v1/erp/categories', createErpCategoriesRouter(
    createCategoryService({ repository: categories, resolveBranchContext }),
  ));
  app.use('/api/v1/erp/services', createErpServicesRouter(
    createServiceCatalogService({
      repository: repositories.services ?? serviceRepository(),
      categories,
      employees,
      resolveBranchContext,
    }),
  ));
  return app;
};

describe('ERP categories HTTP API', () => {
  it('refuses an employee session and an admin session with no acting account', async () => {
    // Employees are never ERP business actors, and every ERP write must record
    // the acting account, so an accountless admin session cannot act either.
    expect((await request(makeApp({ type: 'employee', employeeId: 4 }))
      .get('/api/v1/erp/categories')).status).toBe(403);
    expect((await request(makeApp({ type: 'admin' })).get('/api/v1/erp/categories')).status).toBe(403);
  });

  it('requires an admin to name the branch they act on', async () => {
    const response = await request(makeApp(ADMIN)).get('/api/v1/erp/categories');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('ERP_BRANCH_REQUIRED');
  });

  it('rejects an admin naming a branch that does not exist', async () => {
    const response = await request(makeApp(ADMIN)).get('/api/v1/erp/categories?branchId=99');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ERP_BRANCH_NOT_FOUND');
  });

  it('lets a cashier browse categories of their own branch', async () => {
    const response = await request(makeApp(CASHIER)).get('/api/v1/erp/categories');

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ page: 1, total: 1, totalPages: 1 });
  });

  it('refuses a cashier creating, editing or deleting a category', async () => {
    const app = makeApp(CASHIER);

    for (const call of [
      request(app).post('/api/v1/erp/categories').send({ name: 'شعر', type: 'service' }),
      request(app).patch('/api/v1/erp/categories/1').send({ name: 'شعر' }),
      request(app).delete('/api/v1/erp/categories/1'),
    ]) {
      const response = await call;
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ERP_CATALOG_ADMIN_REQUIRED');
    }
  });

  it('creates a category for the branch the admin named', async () => {
    const create = vi.fn(async (input: Parameters<CategoryRepository['create']>[0]) => category(input));
    const response = await request(makeApp(ADMIN, { categories: categoryRepository({ create }) }))
      .post('/api/v1/erp/categories').send({ name: 'شعر', type: 'service', branchId: 2 });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ branchId: 2 }));
  });

  it('returns field errors for an unknown category type', async () => {
    const response = await request(makeApp(ADMIN))
      .post('/api/v1/erp/categories').send({ name: 'شعر', type: 'product', branchId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fieldErrors.type).toBeDefined();
  });

  it('returns the conflicting category id on a duplicate name', async () => {
    const categories = categoryRepository({
      findByNormalizedName: vi.fn(async () => category({ id: 42 })),
    });
    const response = await request(makeApp(ADMIN, { categories }))
      .post('/api/v1/erp/categories').send({ name: 'شعر', type: 'service', branchId: 1 });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({ code: 'CATEGORY_NAME_EXISTS', existingId: 42 });
  });

  it('reports a referenced category as a conflict rather than deleting it', async () => {
    const categories = categoryRepository({ delete: vi.fn(async () => 'referenced' as const) });
    const response = await request(makeApp(ADMIN, { categories }))
      .delete('/api/v1/erp/categories/1?branchId=1');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CATEGORY_IN_USE');
  });

  it('answers 204 for a successful category deletion', async () => {
    const response = await request(makeApp(ADMIN)).delete('/api/v1/erp/categories/1?branchId=1');

    expect(response.status).toBe(204);
  });

  it('reports a missing category as 404', async () => {
    const categories = categoryRepository({ findById: vi.fn(async () => null) });
    const response = await request(makeApp(ADMIN, { categories }))
      .get('/api/v1/erp/categories/3?branchId=1');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });
});

describe('ERP services HTTP API', () => {
  it('lets a cashier browse services of their own branch', async () => {
    const response = await request(makeApp(CASHIER)).get('/api/v1/erp/services?isActive=true');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ price: '150.00', categoryName: 'شعر' });
  });

  it('stops a cashier from browsing another branch', async () => {
    const response = await request(makeApp(CASHIER)).get('/api/v1/erp/services?branchId=2');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ERP_BRANCH_FORBIDDEN');
  });

  it('refuses a cashier creating or editing a service', async () => {
    const app = makeApp(CASHIER);
    const body = { name: 'صبغة', categoryId: 1, price: '150' };

    expect((await request(app).post('/api/v1/erp/services').send(body)).status).toBe(403);
    expect((await request(app).patch('/api/v1/erp/services/1').send({ price: '150' })).status).toBe(403);
  });

  it('creates a service with the exact price the contract normalized', async () => {
    const create = vi.fn(async (input: Parameters<ServiceRepository['create']>[0]) => service(input));
    const response = await request(makeApp(ADMIN, { services: serviceRepository({ create }) }))
      .post('/api/v1/erp/services')
      .send({ name: 'صبغة', categoryId: 1, price: '150.5', branchId: 1 });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      price: '150.50', commissionPercent: '0.00',
    }));
  });

  it('rejects a float price rather than rounding it', async () => {
    const response = await request(makeApp(ADMIN)).post('/api/v1/erp/services')
      .send({ name: 'صبغة', categoryId: 1, price: 150.5, branchId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error.fieldErrors.price).toBeDefined();
  });

  it('rejects attaching a service to an expense category', async () => {
    const categories = categoryRepository({ findById: vi.fn(async () => category({ type: 'expense' })) });
    const response = await request(makeApp(ADMIN, { categories })).post('/api/v1/erp/services')
      .send({ name: 'صبغة', categoryId: 1, price: '150', branchId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CATEGORY_TYPE_INVALID');
  });

  it('exposes no way to delete a service', async () => {
    // Invoice lines snapshot the service and point back at it, so the row must
    // stay resolvable; retirement is `isActive = false`.
    const response = await request(makeApp(ADMIN)).delete('/api/v1/erp/services/1?branchId=1');

    expect(response.status).toBe(404);
  });

  it('lists the commission overrides of a service', async () => {
    const response = await request(makeApp(ADMIN))
      .get('/api/v1/erp/services/1/commission-overrides?branchId=1');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ employeeId: 4, commissionPercent: '20.00' });
  });

  it('sets a per-employee override', async () => {
    const setOverride = vi.fn(async () => overrideRecord());
    const response = await request(makeApp(ADMIN, { services: serviceRepository({ setOverride }) }))
      .put('/api/v1/erp/services/1/commission-overrides')
      .send({ employeeId: 4, commissionPercent: '20', branchId: 1 });

    expect(response.status).toBe(200);
    expect(setOverride).toHaveBeenCalledWith(1, 4, '20.00');
  });

  it('rejects an override for an employee of another branch as missing', async () => {
    const response = await request(makeApp(ADMIN))
      .put('/api/v1/erp/services/1/commission-overrides')
      .send({ employeeId: 99, commissionPercent: '20', branchId: 1 });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CATALOG_EMPLOYEE_NOT_FOUND');
  });

  it('removes an override and reports a missing one as 404', async () => {
    expect((await request(makeApp(ADMIN))
      .delete('/api/v1/erp/services/1/commission-overrides/4?branchId=1')).status).toBe(204);

    const services = serviceRepository({ deleteOverride: vi.fn(async () => false) });
    const response = await request(makeApp(ADMIN, { services }))
      .delete('/api/v1/erp/services/1/commission-overrides/4?branchId=1');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('COMMISSION_OVERRIDE_NOT_FOUND');
  });

  it('refuses a cashier changing commission overrides', async () => {
    const app = makeApp(CASHIER);

    expect((await request(app).put('/api/v1/erp/services/1/commission-overrides')
      .send({ employeeId: 4, commissionPercent: '20' })).status).toBe(403);
    expect((await request(app)
      .delete('/api/v1/erp/services/1/commission-overrides/4')).status).toBe(403);
  });
});
