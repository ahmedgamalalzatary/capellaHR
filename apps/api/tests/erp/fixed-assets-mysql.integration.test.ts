import { accounts, branches, auditEvents, erpFixedAssets } from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuditModule } from '../../src/modules/audit/index.js';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createErpFixedAssetsModule, type ErpAccountIdentity } from '../../src/modules/erp/index.js';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();
const module = createErpFixedAssetsModule(database, {
  audit: createAuditModule(database).erp,
  branches: createBranchesModule(database).erp,
});
let ADMIN: ErpAccountIdentity = { role: 'admin', accountId: 0 };
let branchId = 0;
let otherBranchId = 0;
let sequence = 0;

const seedBranch = async () => {
  const at = new Date();
  const suffix = `${process.pid}-${++sequence}`;
  const inserted = await database.insert(branches).values({
    name: `Assets ${suffix}`, nameNormalized: `assets-${suffix}`, location: 'Cairo',
    latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50,
    createdAt: at, updatedAt: at,
  });
  return Number(inserted[0].insertId);
};

beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  const at = new Date();
  const accountId = Number((await database.insert(accounts).values({
    username: `assets-admin-${process.pid}`, passwordHash: 'test-only', role: 'admin', createdAt: at, updatedAt: at,
  }))[0].insertId);
  ADMIN = { role: 'admin', accountId };
  branchId = await seedBranch();
  otherBranchId = await seedBranch();
}, 120_000);

afterAll(async () => {
  await closeMysqlIntegrationDatabase(database);
});

beforeEach(async () => {
  await database.delete(erpFixedAssets);
});

describe('ERP fixed assets against MySQL', () => {
  it('stores a line that carries nothing but a name, leaving the unwritten detail empty', async () => {
    const created = await module.service.create(ADMIN, { branchId, name: 'مرآة' });

    expect(created).toMatchObject({
      name: 'مرآة', quantity: null, unitPrice: null, location: '', note: '',
      purchasedOn: null, condition: null, actingAccountId: ADMIN.accountId,
    });
  });

  it('keeps the price exact and the details as written', async () => {
    const created = await module.service.create(ADMIN, {
      branchId, name: 'مكيف', quantity: 3, unitPrice: '15000.00',
      location: 'صالة 1', note: 'ضمان سنتين', purchasedOn: '2026-03-01', condition: 'good',
    });

    expect(created).toMatchObject({
      quantity: 3, unitPrice: '15000.00', location: 'صالة 1',
      purchasedOn: '2026-03-01', condition: 'good',
    });
  });

  it('refuses a quantity no counted thing can have', async () => {
    await expect(database.insert(erpFixedAssets).values({
      branchId, name: 'كرسي', quantity: 0, actingAccountId: ADMIN.accountId,
      createdAt: new Date(), updatedAt: new Date(),
    })).rejects.toThrow();
  });

  it('refuses a line whose name is nothing but spaces', async () => {
    await expect(database.insert(erpFixedAssets).values({
      branchId, name: '   ', actingAccountId: ADMIN.accountId,
      createdAt: new Date(), updatedAt: new Date(),
    })).rejects.toThrow();
  });

  it('edits a line in place and records what it looked like before', async () => {
    const created = await module.service.create(ADMIN, { branchId, name: 'كرسي', quantity: 10 });
    const updated = await module.service.update(ADMIN, created.id, {
      branchId, name: 'كرسي انتظار', quantity: 8, location: 'الاستقبال',
    });

    expect(updated).toMatchObject({ id: created.id, name: 'كرسي انتظار', quantity: 8, location: 'الاستقبال' });
    const audited = await database.select().from(auditEvents).where(eq(auditEvents.entityId, String(created.id)));
    expect(audited.map((event) => event.action)).toEqual(['create', 'update']);
  });

  it('deletes a line for good, leaving the audit entry as its only trace', async () => {
    const created = await module.service.create(ADMIN, { branchId, name: 'تكييف قديم' });
    await module.service.remove(ADMIN, created.id, branchId);

    expect(await database.select().from(erpFixedAssets).where(eq(erpFixedAssets.id, created.id))).toEqual([]);
    const audited = await database.select().from(auditEvents).where(eq(auditEvents.entityId, String(created.id)));
    expect(audited.map((event) => event.action)).toContain('delete');
    await expect(module.service.get(ADMIN, created.id, branchId)).rejects.toMatchObject({ code: 'FIXED_ASSET_NOT_FOUND' });
  });

  it('lets only one of two admins racing to delete the same line delete it', async () => {
    const created = await module.service.create(ADMIN, { branchId, name: 'كرسي' });

    const outcomes = await Promise.allSettled([
      module.service.remove(ADMIN, created.id, branchId),
      module.service.remove(ADMIN, created.id, branchId),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const audited = await database.select().from(auditEvents).where(eq(auditEvents.entityId, String(created.id)));
    // One line deleted once: a second trace would claim a deletion that never happened.
    expect(audited.filter((event) => event.action === 'delete')).toHaveLength(1);
  });

  it('records no edit for a line another admin deleted at the same moment', async () => {
    const created = await module.service.create(ADMIN, { branchId, name: 'كرسي' });

    const [edit] = await Promise.allSettled([
      module.service.update(ADMIN, created.id, { branchId, name: 'كرسي انتظار' }),
      module.service.remove(ADMIN, created.id, branchId),
    ]);

    const audited = await database.select().from(auditEvents).where(eq(auditEvents.entityId, String(created.id)));
    if (edit.status === 'rejected') expect(audited.map((event) => event.action)).not.toContain('update');
    expect(await database.select().from(erpFixedAssets).where(eq(erpFixedAssets.id, created.id))).toEqual([]);
  });

  it('never shows, edits or deletes another branch register', async () => {
    const mine = await module.service.create(ADMIN, { branchId, name: 'كرسي' });
    const theirs = await module.service.create(ADMIN, { branchId: otherBranchId, name: 'مكيف' });

    const listed = await module.service.list(ADMIN, { branchId, page: 1, pageSize: 20 });
    expect(listed.items.map((item) => item.id)).toEqual([mine.id]);
    await expect(module.service.get(ADMIN, theirs.id, branchId)).rejects.toMatchObject({ code: 'FIXED_ASSET_NOT_FOUND' });
    await expect(module.service.update(ADMIN, theirs.id, { branchId, name: 'x' })).rejects.toMatchObject({ code: 'FIXED_ASSET_NOT_FOUND' });
    await expect(module.service.remove(ADMIN, theirs.id, branchId)).rejects.toMatchObject({ code: 'FIXED_ASSET_NOT_FOUND' });
  });

  it('finds a line by its name, where it stands, or the note beside it', async () => {
    await module.service.create(ADMIN, { branchId, name: 'كرسي', location: 'الاستقبال', note: 'جلد' });
    await module.service.create(ADMIN, { branchId, name: 'مكيف', location: 'صالة 1', note: 'ضمان' });

    const byName = await module.service.list(ADMIN, { branchId, search: 'كرسي', page: 1, pageSize: 20 });
    const byLocation = await module.service.list(ADMIN, { branchId, search: 'صالة', page: 1, pageSize: 20 });
    const byNote = await module.service.list(ADMIN, { branchId, search: 'جلد', page: 1, pageSize: 20 });

    expect(byName.items.map((item) => item.name)).toEqual(['كرسي']);
    expect(byLocation.items.map((item) => item.name)).toEqual(['مكيف']);
    expect(byNote.items.map((item) => item.name)).toEqual(['كرسي']);
  });
});
