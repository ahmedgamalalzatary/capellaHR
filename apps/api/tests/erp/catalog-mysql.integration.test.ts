import { createDatabase } from '@capella/database';
import {
  auditEvents,
  branches,
  employees,
  erpCategories,
  erpServiceCommissionOverrides,
  erpServices,
} from '@capella/database/schema';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuditModule } from '../../src/modules/audit/index.js';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createEmployeesModule } from '../../src/modules/employees/index.js';
import {
  createErpCatalogModule,
  type ErpAccountIdentity,
} from '../../src/modules/erp/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const auditModule = createAuditModule(database);

const module = createErpCatalogModule(database, {
  audit: auditModule.erp,
  branches: createBranchesModule(database).erp,
  employees: createEmployeesModule(database, 1).erp,
});

const ADMIN: ErpAccountIdentity = { role: 'admin', accountId: 1 };

/**
 * Branches and employees are shared with other suites' rows, so this suite never
 * deletes them — it seeds its own uniquely named ones and scopes every assertion
 * by their ids.
 */
let sequence = 0;
const unique = () => {
  sequence += 1;
  return `${process.pid}-${sequence}-${Date.now()}`;
};

const seedBranch = async () => {
  const name = `Capella Catalog ${unique()}`;
  const at = new Date();
  const result = await database.insert(branches).values({
    name,
    nameNormalized: name,
    location: 'Nasr City',
    latitude: 30,
    longitude: 31,
    gpsAccuracyMeters: 5,
    attendanceRadiusMeters: 50,
    createdAt: at,
    updatedAt: at,
  });
  return Number(result[0].insertId);
};

// Employees are never deleted by this suite, so the code base is time-derived
// to stay unique across runs; the phone is the locked 11-digit Egyptian form.
let employeeCode = 90000000 + (Date.now() % 9000000);
const seedEmployee = async (branchId: number) => {
  employeeCode += 1;
  const at = new Date();
  const phone = `010${String(employeeCode)}`;
  const result = await database.insert(employees).values({
    employeeCode,
    fullName: 'مصففة',
    personalPhone: phone,
    whatsappPhone: phone,
    pinHash: 'hash',
    age: 30,
    address: 'القاهرة',
    branchId,
    shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00',
    createdAt: at,
    updatedAt: at,
  });
  return Number(result[0].insertId);
};

const page = { page: 1 as const, pageSize: 20 as const };

const createCategory = (branchId: number, name = 'شعر', type: 'service' | 'expense' = 'service') =>
  module.categories.create(ADMIN, { name, type, branchId });

const createService = (branchId: number, categoryId: number, overrides: {
  name?: string;
  price?: string;
  commissionPercent?: string;
} = {}) => module.services.create(ADMIN, {
  name: overrides.name ?? 'صبغة',
  categoryId,
  price: overrides.price ?? '150.00',
  commissionPercent: overrides.commissionPercent ?? '10.00',
  branchId,
});

/**
 * The catalog tables belong to this suite alone, so they are cleared wholesale.
 * Audit events are shared with every other module's suites, so only this
 * module's rows are removed.
 */
const clearCatalog = async () => {
  await database.delete(erpServiceCommissionOverrides);
  await database.delete(erpServices);
  await database.delete(erpCategories);
  await database.delete(auditEvents).where(eq(auditEvents.module, 'erp-catalog'));
};

beforeEach(clearCatalog);

// Suites run sequentially against one database and later ones clear `branches`
// wholesale, so this suite must leave no rows pointing at a branch behind.
afterAll(clearCatalog);

describe('MySQL-backed ERP categories', () => {
  it('persists a category, searches it, updates it, and audits both writes', async () => {
    const branchId = await seedBranch();
    const created = await createCategory(branchId);

    expect((await module.categories.list(ADMIN, { ...page, branchId, search: 'شعر' })).total).toBe(1);

    const updated = await module.categories.update(ADMIN, created.id, { name: 'شعر وتصفيف', branchId });
    expect(updated.name).toBe('شعر وتصفيف');

    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'erp-catalog')).orderBy(asc(auditEvents.id));
    expect(events.map(({ action }) => action)).toEqual(['create', 'update']);
    expect(events[1]).toMatchObject({
      entityType: 'category',
      entityId: String(created.id),
      beforeState: expect.objectContaining({ name: 'شعر' }),
      afterState: expect.objectContaining({ name: 'شعر وتصفيف' }),
    });
  });

  it('treats search text literally so a typed wildcard matches nothing', async () => {
    const branchId = await seedBranch();
    await createCategory(branchId);

    expect((await module.categories.list(ADMIN, { ...page, branchId, search: '%' })).total).toBe(0);
  });

  it('makes the name unique within a type but free across types and branches', async () => {
    const first = await seedBranch();
    const second = await seedBranch();
    const created = await createCategory(first, 'شعر', 'service');

    await expect(createCategory(first, 'شعر', 'service'))
      .rejects.toMatchObject({ code: 'CATEGORY_NAME_EXISTS', existingId: created.id });
    await expect(createCategory(first, 'شعر', 'expense')).resolves.toMatchObject({ type: 'expense' });
    await expect(createCategory(second, 'شعر', 'service')).resolves.toMatchObject({ branchId: second });
  });

  it('enforces the duplicate rule at the database, not only in the pre-check', async () => {
    const branchId = await seedBranch();
    const created = await createCategory(branchId);
    const row = (await database.select().from(erpCategories)
      .where(eq(erpCategories.id, created.id)).limit(1))[0]!;

    // Bypasses the service pre-check the way a lost race would.
    const at = new Date();
    await expect(database.insert(erpCategories).values({
      branchId, type: 'service', name: 'شعر أخرى', nameNormalized: row.nameNormalized,
      createdAt: at, updatedAt: at,
    })).rejects.toThrow();
  });

  it('filters by type and by active state', async () => {
    const branchId = await seedBranch();
    const retired = await createCategory(branchId, 'مكياج', 'service');
    await createCategory(branchId, 'إيجار', 'expense');
    await module.categories.update(ADMIN, retired.id, { isActive: false, branchId });

    expect((await module.categories.list(ADMIN, { ...page, branchId, type: 'expense' })).total).toBe(1);
    expect((await module.categories.list(ADMIN, { ...page, branchId, isActive: true })).total).toBe(1);
    expect((await module.categories.list(ADMIN, { ...page, branchId, isActive: false })).total).toBe(1);
  });

  it('deletes an unused category but refuses once a service has referenced it', async () => {
    const branchId = await seedBranch();
    const unused = await createCategory(branchId, 'غير مستخدم');
    await expect(module.categories.remove(ADMIN, unused.id, branchId)).resolves.toBeUndefined();

    const used = await createCategory(branchId, 'شعر');
    await createService(branchId, used.id);

    await expect(module.categories.remove(ADMIN, used.id, branchId))
      .rejects.toMatchObject({ code: 'CATEGORY_IN_USE' });
    // The protection is permanent: it survives the referencing service being retired.
    expect((await module.categories.get(ADMIN, used.id, branchId)).hasEverBeenReferenced).toBe(true);
  });

  it('hides another branch\'s category from reads, updates, and deletion', async () => {
    const first = await seedBranch();
    const second = await seedBranch();
    const created = await createCategory(first);

    await expect(module.categories.get(ADMIN, created.id, second))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
    await expect(module.categories.update(ADMIN, created.id, { name: 'مخترق', branchId: second }))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
    await expect(module.categories.remove(ADMIN, created.id, second))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });

    expect((await module.categories.get(ADMIN, created.id, first)).name).toBe('شعر');
  });
});

describe('MySQL-backed ERP services', () => {
  it('stores and returns the fixed price and commission as exact decimals', async () => {
    const branchId = await seedBranch();
    const category = await createCategory(branchId);
    const created = await createService(branchId, category.id, {
      price: '1234.05', commissionPercent: '12.50',
    });

    const read = await module.services.get(ADMIN, created.id, branchId);
    expect(read.price).toBe('1234.05');
    expect(read.commissionPercent).toBe('12.50');
  });

  it('rejects a non-positive price and an out-of-range rate at the database level', async () => {
    const branchId = await seedBranch();
    const category = await createCategory(branchId);
    const at = new Date();
    const row = {
      branchId, categoryId: category.id, name: 'س', nameNormalized: unique(),
      description: null, createdAt: at, updatedAt: at,
    };

    await expect(database.insert(erpServices)
      .values({ ...row, price: '0.00', commissionPercent: '10.00' })).rejects.toThrow();
    await expect(database.insert(erpServices)
      .values({ ...row, price: '10.00', commissionPercent: '100.01' })).rejects.toThrow();
  });

  it('marks the category permanently referenced inside the service creation', async () => {
    const branchId = await seedBranch();
    const category = await createCategory(branchId);
    expect(category.hasEverBeenReferenced).toBe(false);

    await createService(branchId, category.id);

    expect((await module.categories.get(ADMIN, category.id, branchId)).hasEverBeenReferenced)
      .toBe(true);
  });

  it('refuses a service in another branch\'s category and rolls nothing in', async () => {
    const first = await seedBranch();
    const second = await seedBranch();
    const category = await createCategory(second);

    await expect(createService(first, category.id))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
    expect((await module.services.list(ADMIN, { ...page, branchId: first })).total).toBe(0);
  });

  it('retires a service without removing it and hides it from active browsing', async () => {
    const branchId = await seedBranch();
    const category = await createCategory(branchId);
    const created = await createService(branchId, category.id);

    await module.services.update(ADMIN, created.id, { isActive: false, branchId });

    expect((await module.services.list(ADMIN, { ...page, branchId, isActive: true })).total).toBe(0);
    expect((await module.services.list(ADMIN, { ...page, branchId })).total).toBe(1);
    // The row survives, so a future invoice line can still resolve it.
    expect(await module.services.get(ADMIN, created.id, branchId)).toMatchObject({ isActive: false });
  });

  it('hides services of a deactivated category from active browsing', async () => {
    const branchId = await seedBranch();
    const category = await createCategory(branchId);
    await createService(branchId, category.id);

    await module.categories.update(ADMIN, category.id, { isActive: false, branchId });

    expect((await module.services.list(ADMIN, { ...page, branchId, isActive: true })).total).toBe(0);
    const [item] = (await module.services.list(ADMIN, { ...page, branchId })).items;
    expect(item).toMatchObject({ categoryName: 'شعر', categoryIsActive: false });
  });

  it('searches services literally by name and filters by category', async () => {
    const branchId = await seedBranch();
    const hair = await createCategory(branchId, 'شعر');
    const nails = await createCategory(branchId, 'أظافر');
    await createService(branchId, hair.id, { name: 'صبغة' });
    await createService(branchId, nails.id, { name: 'مانيكير' });

    expect((await module.services.list(ADMIN, { ...page, branchId, search: 'صبغة' })).total).toBe(1);
    expect((await module.services.list(ADMIN, { ...page, branchId, search: '%' })).total).toBe(0);
    expect((await module.services.list(ADMIN, { ...page, branchId, categoryId: nails.id })).total)
      .toBe(1);
  });

  it('audits service creation and updates without losing the previous values', async () => {
    const branchId = await seedBranch();
    const category = await createCategory(branchId);
    const created = await createService(branchId, category.id, { price: '150.00' });

    await module.services.update(ADMIN, created.id, { price: '175.00', branchId });

    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.entityType, 'service')).orderBy(asc(auditEvents.id));
    expect(events.map(({ action }) => action)).toEqual(['create', 'update']);
    expect(events[1]).toMatchObject({
      beforeState: expect.objectContaining({ price: '150.00' }),
      afterState: expect.objectContaining({ price: '175.00' }),
    });
  });
});

describe('MySQL-backed ERP service commission overrides', () => {
  it('upserts concurrent writes for the same employee and service', async () => {
    const branchId = await seedBranch();
    const employeeId = await seedEmployee(branchId);
    const category = await createCategory(branchId);
    const created = await createService(branchId, category.id);

    await expect(Promise.all([
      module.services.setCommissionOverride(ADMIN, created.id, {
        employeeId, commissionPercent: '20.00', branchId,
      }),
      module.services.setCommissionOverride(ADMIN, created.id, {
        employeeId, commissionPercent: '25.00', branchId,
      }),
    ])).resolves.toHaveLength(2);

    const overrides = await module.services.listCommissionOverrides(ADMIN, created.id, branchId);
    expect(overrides).toHaveLength(1);
    expect(['20.00', '25.00']).toContain(overrides[0]?.commissionPercent);
  });

  it('replaces an existing override instead of stacking a second row', async () => {
    const branchId = await seedBranch();
    const employeeId = await seedEmployee(branchId);
    const category = await createCategory(branchId);
    const created = await createService(branchId, category.id);

    await module.services.setCommissionOverride(ADMIN, created.id, {
      employeeId, commissionPercent: '20.00', branchId,
    });
    await module.services.setCommissionOverride(ADMIN, created.id, {
      employeeId, commissionPercent: '25.00', branchId,
    });

    const overrides = await module.services.listCommissionOverrides(ADMIN, created.id, branchId);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ employeeId, commissionPercent: '25.00' });
  });

  it('enforces one override per employee per service at the database level', async () => {
    const branchId = await seedBranch();
    const employeeId = await seedEmployee(branchId);
    const category = await createCategory(branchId);
    const created = await createService(branchId, category.id);
    await module.services.setCommissionOverride(ADMIN, created.id, {
      employeeId, commissionPercent: '20.00', branchId,
    });

    const at = new Date();
    await expect(database.insert(erpServiceCommissionOverrides).values({
      serviceId: created.id, employeeId, commissionPercent: '30.00', createdAt: at, updatedAt: at,
    })).rejects.toThrow();
  });

  it('refuses an override for an employee of another branch', async () => {
    const branchId = await seedBranch();
    const otherBranchId = await seedBranch();
    const outsider = await seedEmployee(otherBranchId);
    const category = await createCategory(branchId);
    const created = await createService(branchId, category.id);

    await expect(module.services.setCommissionOverride(ADMIN, created.id, {
      employeeId: outsider, commissionPercent: '20.00', branchId,
    })).rejects.toMatchObject({ code: 'CATALOG_EMPLOYEE_NOT_FOUND' });
  });

  it('removes an override and audits both the write and the removal', async () => {
    const branchId = await seedBranch();
    const employeeId = await seedEmployee(branchId);
    const category = await createCategory(branchId);
    const created = await createService(branchId, category.id);
    await module.services.setCommissionOverride(ADMIN, created.id, {
      employeeId, commissionPercent: '20.00', branchId,
    });

    await module.services.removeCommissionOverride(ADMIN, created.id, employeeId, branchId);

    expect(await module.services.listCommissionOverrides(ADMIN, created.id, branchId)).toEqual([]);
    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.entityType, 'service-commission-override')).orderBy(asc(auditEvents.id));
    expect(events.map(({ action }) => action)).toEqual(['create', 'delete']);
  });
});
