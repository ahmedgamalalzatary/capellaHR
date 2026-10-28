import { accounts, branches, erpBranchLinks, erpProducts, erpProductLinks, erpProductStocks } from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { matchKeyFor, normalizeCatalogName } from '../../src/modules/erp/catalog/index.js';
import { createDrizzleProductSyncRepository, createProductSyncService } from '../../src/modules/erp/product-sync/index.js';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();
const at = new Date('2026-09-05T09:00:00Z');
let adminId = 0;
const admin = { role: 'admin' as const, get accountId() { return adminId; } };

beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  adminId = Number((await database.insert(accounts).values({
    username: 'sync-admin', passwordHash: 'unused', role: 'admin', createdAt: at, updatedAt: at,
  }))[0].insertId);
}, 180_000);
afterAll(() => closeMysqlIntegrationDatabase(database), 30_000);

let sequence = 0;
const branch = async () => {
  sequence += 1;
  const marker = `sync-${sequence}-${Date.now()}`;
  return Number((await database.insert(branches).values({
    name: marker, nameNormalized: marker, location: 'Cairo', latitude: 30, longitude: 31,
    gpsAccuracyMeters: 5, attendanceRadiusMeters: 100, createdAt: at, updatedAt: at,
  }))[0].insertId);
};

const product = async (branchId: number, name: string, options: { barcode?: string | null; description?: string | null } = {}) => {
  sequence += 1;
  const id = Number((await database.insert(erpProducts).values({
    branchId, name, nameNormalized: normalizeCatalogName(name), matchKey: matchKeyFor(name),
    description: options.description ?? null, sellingPrice: '90.00', lastPurchaseCost: '40.00',
    barcode: options.barcode ?? null, isActive: true, awaitingFirstStock: false, createdAt: at, updatedAt: at,
  }))[0].insertId);
  await database.insert(erpProductStocks).values({ productId: id, branchId, quantity: 5, updatedAt: at });
  return id;
};

const repository = () => createDrizzleProductSyncRepository(database, createErpAuditCapability(), () => at);
const service = () => createProductSyncService({ repository: repository() });
let senderBranchId = 0;
let receiverBranchId = 0;

const freshPair = async () => {
  senderBranchId = await branch();
  receiverBranchId = await branch();
};

describe('ERP product sync setup', () => {
  it('refuses a Cashier before touching anything', async () => {
    await expect(service().list({ role: 'cashier', accountId: adminId, branchId: 1 }))
      .rejects.toMatchObject({ code: 'SYNC_ADMIN_REQUIRED' });
  });

  it('refuses the disallowed link shapes with a reason', async () => {
    const a = await branch();
    const b = await branch();
    const c = await branch();
    const d = await branch();
    senderBranchId = a;
    receiverBranchId = b;

    await expect(service().create(admin, { senderBranchId: a, receiverBranchId: a }))
      .rejects.toMatchObject({ code: 'SYNC_SAME_BRANCH' });

    const ab = await service().create(admin, { senderBranchId: a, receiverBranchId: b });
    expect(ab).toMatchObject({ state: 'pending', senderBranchName: expect.any(String) });

    // Reverse, two senders for one receiver, and a chain: each has its reason.
    await expect(service().create(admin, { senderBranchId: b, receiverBranchId: a }))
      .rejects.toMatchObject({ code: 'SYNC_SENDER_IS_RECEIVER' });
    await expect(service().create(admin, { senderBranchId: d, receiverBranchId: b }))
      .rejects.toMatchObject({ code: 'SYNC_RECEIVER_TAKEN' });
    await expect(service().create(admin, { senderBranchId: b, receiverBranchId: c }))
      .rejects.toMatchObject({ code: 'SYNC_SENDER_IS_RECEIVER' });

    // A sender may feed many receivers.
    await expect(service().create(admin, { senderBranchId: a, receiverBranchId: c }))
      .resolves.toMatchObject({ state: 'pending' });
  });

  it('links by itself when the barcode is the same', async () => {
    await freshPair();
    const barcode = `9${String(Date.now()).slice(-12)}`;
    const a = await product(senderBranchId, 'شامبو الأرغان', { barcode });
    const b = await product(receiverBranchId, 'Shampoo Argan', { barcode });
    const created = await service().create(admin, { senderBranchId, receiverBranchId });

    const setup = await service().setup(admin, created.id);
    expect(setup.rows).toHaveLength(1);
    expect(setup.rows[0]).toMatchObject({
      senderProductId: a, state: 'green', kind: 'auto', receiverProductId: b,
    });
    expect(setup.allGreen).toBe(true);
  });

  it('asks when one product matches two on the other side', async () => {
    await freshPair();
    const a = await product(senderBranchId, 'Hair Oil');
    // Same smart name, different in-branch spelling: both fit in one branch.
    await product(receiverBranchId, 'Hair Oil');
    await product(receiverBranchId, 'Hair  Oil');
    const created = await service().create(admin, { senderBranchId, receiverBranchId });

    const setup = await service().setup(admin, created.id);
    expect(setup.rows[0]).toMatchObject({ senderProductId: a, state: 'conflict', kind: 'ambiguous' });
    expect(setup.rows[0]!.candidates).toHaveLength(2);
    expect(setup.allGreen).toBe(false);
  });

  it('asks when the names agree but the barcodes disagree', async () => {
    await freshPair();
    const a = await product(senderBranchId, 'بلسم', { barcode: '1111111111111' });
    await product(receiverBranchId, 'بلسم', { barcode: '2222222222222' });
    const created = await service().create(admin, { senderBranchId, receiverBranchId });

    const setup = await service().setup(admin, created.id);
    expect(setup.rows[0]).toMatchObject({ senderProductId: a, state: 'conflict', kind: 'barcode_mismatch' });
  });

  it('creates B copy as awaiting first stock, under the name the admin typed', async () => {
    await freshPair();
    const a = await product(senderBranchId, 'سيروم', { description: 'زيت خفيف' });
    const created = await service().create(admin, { senderBranchId, receiverBranchId });
    expect((await service().setup(admin, created.id)).allGreen).toBe(false);

    const after = await service().settle(admin, created.id, a, { action: 'create', name: 'سيروم فاخر' });
    expect(after.allGreen).toBe(true);
    expect(after.rows[0]).toMatchObject({ state: 'green', kind: 'linked' });

    const copied = (await database.select().from(erpProducts).where(and(
      eq(erpProducts.branchId, receiverBranchId),
      eq(erpProducts.name, 'سيروم فاخر'),
    )).limit(1))[0]!;
    expect(copied).toMatchObject({
      description: 'زيت خفيف', sellingPrice: '0.00', lastPurchaseCost: '0.00',
      barcode: null, isActive: false, awaitingFirstStock: true,
    });
    expect(copied.matchKey).toBe(matchKeyFor('سيروم فاخر'));
  });

  it('refuses a copy name the receiving branch already uses', async () => {
    await freshPair();
    const a = await product(senderBranchId, 'كريم');
    await product(receiverBranchId, 'كريم');
    const created = await service().create(admin, { senderBranchId, receiverBranchId });

    await expect(service().settle(admin, created.id, a, { action: 'create', name: 'كريم' }))
      .rejects.toMatchObject({ code: 'SYNC_NAME_TAKEN' });
  });

  it('keeps "don\'t copy" as a settled answer and lists it', async () => {
    await freshPair();
    const a = await product(senderBranchId, 'مقشر');
    const compared = await product(receiverBranchId, 'مقشر');
    const created = await service().create(admin, { senderBranchId, receiverBranchId });

    const after = await service().settle(admin, created.id, a, { action: 'exclude', notSameAsProductId: compared });
    expect(after.allGreen).toBe(true);
    expect(after.rows[0]).toMatchObject({ kind: 'excluded', receiverProductId: null });

    expect(await service().excluded(admin, created.id)).toEqual([
      { senderProductId: a, name: 'مقشر', notSameAs: expect.objectContaining({ id: compared }) },
    ]);
    // Still not copied.
    expect(await database.select().from(erpProducts).where(eq(erpProducts.branchId, receiverBranchId)))
      .toHaveLength(1);
  });

  it('refuses to activate while one row is still a question', async () => {
    await freshPair();
    await product(senderBranchId, 'مرطب');
    const created = await service().create(admin, { senderBranchId, receiverBranchId });

    await expect(service().activate(admin, created.id)).rejects.toMatchObject({ code: 'SYNC_SETUP_INCOMPLETE' });
    expect((await database.select().from(erpBranchLinks).where(eq(erpBranchLinks.id, created.id)))[0]?.state)
      .toBe('pending');
  });

  it('activates once every row is green and records the automatic links', async () => {
    await freshPair();
    const barcode = `8${String(Date.now()).slice(-12)}`;
    const a = await product(senderBranchId, 'غسول', { barcode });
    const b = await product(receiverBranchId, 'Wash', { barcode });
    const created = await service().create(admin, { senderBranchId, receiverBranchId });

    const activated = await service().activate(admin, created.id);
    expect(activated.link.state).toBe('active');
    expect(activated.allGreen).toBe(true);
    expect((await database.select().from(erpProductLinks).where(and(
      eq(erpProductLinks.senderProductId, a),
      eq(erpProductLinks.receiverBranchId, receiverBranchId),
    )).limit(1))[0]).toMatchObject({ state: 'linked', receiverProductId: b });
  });

  it('does not sync anything while the link is still pending', async () => {
    await freshPair();
    await product(senderBranchId, 'زيت');
    const created = await service().create(admin, { senderBranchId, receiverBranchId });
    // Preview only: no copy exists in B yet, and no link row was written.
    await service().setup(admin, created.id);
    expect(await database.select().from(erpProducts).where(eq(erpProducts.branchId, receiverBranchId)))
      .toHaveLength(0);
    expect(await database.select().from(erpProductLinks).where(and(
      eq(erpProductLinks.senderBranchId, senderBranchId),
      eq(erpProductLinks.receiverBranchId, receiverBranchId),
    ))).toHaveLength(0);
  });
});
