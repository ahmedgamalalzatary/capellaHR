import { createDatabase } from '@capella/database';
import { auditEvents, branches, clients } from '@capella/database/schema';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAuditModule } from '../../src/modules/audit/index.js';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import {
  createErpClientsModule,
  type ErpAccountIdentity,
  type ErpEmployeeCapability,
} from '../../src/modules/erp/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const auditModule = createAuditModule(database);

/**
 * These tests act as an Admin, who names the branch explicitly, so the employee
 * capability is never consulted. Cashier branch derivation is covered by the
 * router tests, which drive the real resolver.
 */
const employees = {
  findActiveById: async () => null,
} as unknown as ErpEmployeeCapability;

const module = createErpClientsModule(database, {
  audit: auditModule.erp,
  branches: createBranchesModule(database).erp,
  employees,
});

const ADMIN: ErpAccountIdentity = { role: 'admin', accountId: 1 };

/**
 * Branches are shared with other suites' rows (devices, employees, …), so this
 * suite never deletes them — it seeds its own uniquely named ones and scopes
 * every assertion by their ids.
 */
let branchSequence = 0;

const seedBranch = async (label: string) => {
  branchSequence += 1;
  const name = `${label} #${process.pid}-${branchSequence}`;
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

const page = { page: 1 as const, pageSize: 20 as const };

beforeEach(async () => {
  await database.delete(clients);
  await database.delete(auditEvents);
});

describe('MySQL-backed ERP clients', () => {
  it('persists a client, finds it by name and phone, updates it, and audits both writes', async () => {
    const branchId = await seedBranch('Capella');
    const created = await module.service.create(ADMIN, {
      fullName: 'ندى سمير',
      phone: '01001234567',
      branchId,
    });

    expect((await module.service.list(ADMIN, { ...page, branchId, search: 'ندى' })).total).toBe(1);
    expect((await module.service.list(ADMIN, { ...page, branchId, search: '0100123' })).total).toBe(1);
    expect(await module.service.findByPhone(ADMIN, '01001234567', branchId))
      .toMatchObject({ id: created.id });

    const updated = await module.service.update(ADMIN, created.id, {
      fullName: 'ندى سمير علي',
      branchId,
    });
    expect(updated.fullName).toBe('ندى سمير علي');

    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'erp-clients')).orderBy(asc(auditEvents.id));
    expect(events.map(({ action }) => action)).toEqual(['create', 'update']);
    expect(events[1]).toMatchObject({
      entityType: 'client',
      entityId: String(created.id),
      beforeState: expect.objectContaining({ fullName: 'ندى سمير' }),
      afterState: expect.objectContaining({ fullName: 'ندى سمير علي' }),
    });
  });

  it('treats search text literally so a typed wildcard matches nothing', async () => {
    const branchId = await seedBranch('Capella');
    await module.service.create(ADMIN, { fullName: 'ندى', phone: '01001234567', branchId });

    expect((await module.service.list(ADMIN, { ...page, branchId, search: '%' })).total).toBe(0);
  });

  it('rejects a duplicate phone inside a branch but allows it in another branch', async () => {
    const first = await seedBranch('Capella');
    const second = await seedBranch('Capella Two');

    const created = await module.service.create(ADMIN, {
      fullName: 'ندى', phone: '01001234567', branchId: first,
    });

    await expect(module.service.create(ADMIN, {
      fullName: 'شخص آخر', phone: '01001234567', branchId: first,
    })).rejects.toMatchObject({ code: 'CLIENT_PHONE_EXISTS', existingClientId: created.id });

    // Clients are branch-scoped, so the same person at another branch is a
    // separate record rather than a conflict.
    await expect(module.service.create(ADMIN, {
      fullName: 'ندى', phone: '01001234567', branchId: second,
    })).resolves.toMatchObject({ branchId: second });
  });

  it('enforces the duplicate rule at the database, not only in the pre-check', async () => {
    const branchId = await seedBranch('Capella');
    await module.service.create(ADMIN, { fullName: 'ندى', phone: '01001234567', branchId });

    // Bypasses the service pre-check the way a lost race would.
    const at = new Date();
    await expect(database.insert(clients).values({
      branchId, fullName: 'شخص آخر', phone: '01001234567', createdAt: at, updatedAt: at,
    })).rejects.toThrow();
  });

  it('hides another branch\'s client from reads, updates, and lists', async () => {
    const first = await seedBranch('Capella');
    const second = await seedBranch('Capella Two');
    const created = await module.service.create(ADMIN, {
      fullName: 'ندى', phone: '01001234567', branchId: first,
    });

    await expect(module.service.get(ADMIN, created.id, second))
      .rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
    await expect(module.service.update(ADMIN, created.id, { fullName: 'مخترق', branchId: second }))
      .rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
    await expect(module.service.findByPhone(ADMIN, '01001234567', second))
      .rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
    expect((await module.service.list(ADMIN, { ...page, branchId: second })).total).toBe(0);

    // The cross-branch update attempt must not have changed anything.
    expect((await module.service.get(ADMIN, created.id, first)).fullName).toBe('ندى');
  });

  it('rejects a phone that is not a normalized Egyptian mobile at the column level', async () => {
    const branchId = await seedBranch('Capella');
    const at = new Date();

    await expect(database.insert(clients).values({
      branchId, fullName: 'ندى', phone: '01301234567', createdAt: at, updatedAt: at,
    })).rejects.toThrow();
  });
});
