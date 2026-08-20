import { createDatabase } from '@capella/database';
import {
  accounts,
  auditEvents,
  branches,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  erpProducts,
  erpProductStocks,
  erpStockMovements,
  erpStockTransferLines,
  erpStockTransfers,
  invoiceLines,
  invoices,
} from '@capella/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createErpBranchContextResolver } from '../../src/modules/erp/branch-context.js';
import { createDrizzleInvoiceSequenceStore } from '../../src/modules/erp/sales/invoice-sequence-store.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { createSaleService } from '../../src/modules/erp/sales/sale-service.js';
import { createInvoiceNumberAllocator } from '../../src/modules/erp/sales/services/invoice-number.js';
import { createDrizzleStockTransferRepository } from '../../src/modules/erp/transfers/index.js';
import { createStockTransferService } from '../../src/modules/erp/transfers/index.js';

const controlDatabase = createDatabase(process.env.DATABASE_URL ?? '');
const isolatedDatabaseName = `capella_hr_test_transfers_${process.pid}_${Date.now()}`;
const isolatedDatabaseUrl = new URL(process.env.DATABASE_URL ?? '');
isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`;
const database = createDatabase(isolatedDatabaseUrl.toString());

const at = new Date('2026-08-17T09:00:00.000Z');
const admin = { accountId: 0, role: 'admin' as const };

beforeAll(async () => {
  if (!/^capella_hr_test_transfers_\d+_\d+$/u.test(isolatedDatabaseName)) {
    throw new Error('Unsafe transfer integration database name');
  }
  await controlDatabase.execute(sql.raw(
    `CREATE DATABASE \`${isolatedDatabaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  ));
  await migrate(database, {
    migrationsFolder: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../packages/database/migrations',
    ),
  });
  admin.accountId = Number((await database.insert(accounts).values({
    username: 'transfer-admin', passwordHash: 'unused', role: 'admin', createdAt: at, updatedAt: at,
  }))[0].insertId);
}, 180_000);

afterAll(async () => {
  await database.$client.promise().end();
  await controlDatabase.execute(sql.raw(`DROP DATABASE IF EXISTS \`${isolatedDatabaseName}\``));
  await controlDatabase.$client.promise().end();
}, 30_000);

let sequence = 0;
const branch = async (label: string) => {
  sequence += 1;
  const marker = `${label}-${sequence}-${Date.now()}`;
  return Number((await database.insert(branches).values({
    name: marker, nameNormalized: marker, location: 'Cairo', latitude: 30, longitude: 31,
    gpsAccuracyMeters: 5, attendanceRadiusMeters: 100, createdAt: at, updatedAt: at,
  }))[0].insertId);
};

const fixture = async (options: { cost?: string; quantity?: number } = {}) => {
  const sourceBranchId = await branch('source');
  const destinationBranchId = await branch('destination');
  sequence += 1;
  // Deliberately no employee and no roster: internal trade needs neither.
  const productId = Number((await database.insert(erpProducts).values({
    branchId: sourceBranchId, name: 'شامبو الأرغان', nameNormalized: `shampoo-${sequence}`,
    description: 'زيت الأرغان', sellingPrice: '80.00',
    lastPurchaseCost: options.cost ?? '30.00', lowStockThreshold: 3,
    createdAt: at, updatedAt: at,
  }))[0].insertId);
  await database.insert(erpProductStocks).values({
    productId, branchId: sourceBranchId, quantity: options.quantity ?? 10, updatedAt: at,
  });
  await database.insert(cashierSessions).values({
    branchId: sourceBranchId, openedByAccountId: admin.accountId, openedAt: at,
  });
  return { sourceBranchId, destinationBranchId, productId };
};

const service = () => {
  const audit = createErpAuditCapability();
  const branchCapability = {
    findById: async (id: number) => {
      const row = (await database.select({ id: branches.id, name: branches.name }).from(branches)
        .where(eq(branches.id, id)).limit(1))[0];
      return row ?? null;
    },
  };
  const sales = createSaleService({
    repository: createDrizzleSaleRepository(database, audit),
    resolveBranchContext: createErpBranchContextResolver({ branches: branchCapability }),
    assignment: { assertAssignable: async () => { throw new Error('not used'); } },
    invoiceNumbers: createInvoiceNumberAllocator(createDrizzleInvoiceSequenceStore(database), () => at),
  });
  return createStockTransferService({
    repository: createDrizzleStockTransferRepository(database, audit),
    sales: sales,
    branches: branchCapability,
    now: () => at,
  });
};

describe('ERP stock transfer MySQL integration', () => {
  it('sells the stock to the receiving branch, which gains it at the same cost', async () => {
    const data = await fixture();

    const transfer = await service().transfer(admin, {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      note: 'نقل مخزون',
      lines: [{ productId: data.productId, quantity: 4 }],
    });

    expect(transfer).toMatchObject({ totalCost: '120.00', note: 'نقل مخزون' });
    expect(transfer.lines).toHaveLength(1);

    // The sending branch shows a real sale at cost, not at the 80.00 shelf price.
    const invoice = (await database.select().from(invoices)
      .where(eq(invoices.id, transfer.invoiceId)).limit(1))[0]!;
    expect(invoice).toMatchObject({
      branchId: data.sourceBranchId, status: 'completed', total: '120.00',
    });
    const line = (await database.select().from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.id)).limit(1))[0]!;
    expect(line).toMatchObject({ unitPrice: '30.00', quantity: 4, lineTotal: '120.00' });
    // Internal trade earns nobody a commission, so the invoice names no seller.
    expect(invoice.sellerEmployeeId).toBeNull();
    expect(invoice.sellerNameSnapshot).toBeNull();
    expect(await database.select().from(commissionLedgerEntries)).toHaveLength(0);
    expect((await database.select().from(clients)
      .where(eq(clients.branchId, data.sourceBranchId)))[0]?.fullName)
      .toContain('تحويل مخزون');

    // The sending branch is down four, the receiving branch up four at cost.
    expect((await database.select({ quantity: erpProductStocks.quantity })
      .from(erpProductStocks).where(and(
        eq(erpProductStocks.productId, data.productId),
        eq(erpProductStocks.branchId, data.sourceBranchId),
      )).limit(1))[0]?.quantity).toBe(6);
    const arrived = (await database.select().from(erpProducts).where(and(
      eq(erpProducts.branchId, data.destinationBranchId),
      eq(erpProducts.id, transfer.lines[0]!.destinationProductId),
    )).limit(1))[0]!;
    expect(arrived).toMatchObject({
      name: 'شامبو الأرغان', sellingPrice: '80.00', lastPurchaseCost: '30.00',
      description: 'زيت الأرغان', lowStockThreshold: 3,
    });
    expect((await database.select({ quantity: erpProductStocks.quantity })
      .from(erpProductStocks).where(eq(erpProductStocks.productId, arrived.id)).limit(1))[0]
      ?.quantity).toBe(4);

    // Both sides are visible in the movement log, each with its own reason.
    const movements = await database.select({
      branchId: erpStockMovements.branchId,
      reason: erpStockMovements.reason,
      delta: erpStockMovements.quantityDelta,
    }).from(erpStockMovements);
    expect(movements).toEqual(expect.arrayContaining([
      { branchId: data.sourceBranchId, reason: 'sale', delta: -4 },
      { branchId: data.destinationBranchId, reason: 'transfer_in', delta: 4 },
    ]));
    expect((await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'erp-stock-transfers'))).length).toBe(1);
  });

  it('adds to the product the receiving branch already keeps, without retouching its price', async () => {
    const data = await fixture();
    const existing = Number((await database.insert(erpProducts).values({
      branchId: data.destinationBranchId, name: 'شامبو الأرغان',
      nameNormalized: (await database.select({ hash: erpProducts.nameNormalized })
        .from(erpProducts).where(eq(erpProducts.id, data.productId)).limit(1))[0]!.hash,
      sellingPrice: '95.00', lastPurchaseCost: '11.00', lowStockThreshold: 1,
      createdAt: at, updatedAt: at,
    }))[0].insertId);
    await database.insert(erpProductStocks).values({
      productId: existing, branchId: data.destinationBranchId, quantity: 2, updatedAt: at,
    });

    const transfer = await service().transfer(admin, {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      lines: [{ productId: data.productId, quantity: 3 }],
    });

    expect(transfer.lines[0]).toMatchObject({
      destinationProductId: existing, unitCost: '30.00', lineTotal: '90.00',
    });
    const after = (await database.select().from(erpProducts)
      .where(eq(erpProducts.id, existing)).limit(1))[0]!;
    // Its own shelf price stands; only the cost follows the goods.
    expect(after).toMatchObject({ sellingPrice: '95.00', lastPurchaseCost: '30.00' });
    expect((await database.select({ quantity: erpProductStocks.quantity })
      .from(erpProductStocks).where(eq(erpProductStocks.productId, existing)).limit(1))[0]
      ?.quantity).toBe(5);
    expect((await database.select({ previous: erpStockTransferLines.previousDestinationCost })
      .from(erpStockTransferLines)
      .where(eq(erpStockTransferLines.transferId, transfer.id)).limit(1))[0]?.previous)
      .toBe('11.00');
  });

  it('moves several products in one transfer', async () => {
    const data = await fixture();
    const second = Number((await database.insert(erpProducts).values({
      branchId: data.sourceBranchId, name: 'بلسم', nameNormalized: `conditioner-${Date.now()}`,
      sellingPrice: '60.00', lastPurchaseCost: '12.50', lowStockThreshold: 2,
      createdAt: at, updatedAt: at,
    }))[0].insertId);
    await database.insert(erpProductStocks).values({
      productId: second, branchId: data.sourceBranchId, quantity: 9, updatedAt: at,
    });

    const transfer = await service().transfer(admin, {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      lines: [
        { productId: data.productId, quantity: 2 },
        { productId: second, quantity: 4 },
      ],
    });

    // 2 × 30.00 plus 4 × 12.50, on one invoice with one transfer record.
    expect(transfer.totalCost).toBe('110.00');
    expect(transfer.lines).toHaveLength(2);
    expect(await database.select().from(erpStockTransferLines)
      .where(eq(erpStockTransferLines.transferId, transfer.id))).toHaveLength(2);
    expect(await database.select().from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, transfer.invoiceId))).toHaveLength(2);
    const arrived = await database.select({ quantity: erpProductStocks.quantity })
      .from(erpProductStocks)
      .where(eq(erpProductStocks.branchId, data.destinationBranchId));
    expect(arrived.map(({ quantity }) => quantity).sort()).toEqual([2, 4]);
  });

  it('replays one key to the same transfer instead of moving the stock twice', async () => {
    const data = await fixture();
    const input = {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      lines: [{ productId: data.productId, quantity: 2 }],
    };

    const first = await service().transfer(admin, input);
    const second = await service().transfer(admin, input);

    expect(second.id).toBe(first.id);
    expect(await database.select().from(erpStockTransfers)
      .where(eq(erpStockTransfers.sourceBranchId, data.sourceBranchId))).toHaveLength(1);
    expect((await database.select({ quantity: erpProductStocks.quantity })
      .from(erpProductStocks).where(and(
        eq(erpProductStocks.productId, data.productId),
        eq(erpProductStocks.branchId, data.sourceBranchId),
      )).limit(1))[0]?.quantity).toBe(8);
  });

  it('replays the loser of two identical requests sent at once', async () => {
    const data = await fixture();
    // A first transfer settles the shared client row and the destination
    // product, so the race under test is only over the one idempotency key.
    await service().transfer(admin, {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      lines: [{ productId: data.productId, quantity: 1 }],
    });
    const input = {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      lines: [{ productId: data.productId, quantity: 2 }],
    };

    const [first, second] = await Promise.all([
      service().transfer(admin, input),
      service().transfer(admin, input),
    ]);

    // The loser replays the transfer the winner posted rather than being told
    // its own key was reused for something else.
    expect(second.id).toBe(first.id);
    expect(await database.select().from(erpStockTransfers).where(
      eq(erpStockTransfers.idempotencyKey, input.idempotencyKey),
    )).toHaveLength(1);
    // Ten, less the warm-up one, less the two moved exactly once.
    expect((await database.select({ quantity: erpProductStocks.quantity })
      .from(erpProductStocks).where(and(
        eq(erpProductStocks.productId, data.productId),
        eq(erpProductStocks.branchId, data.sourceBranchId),
      )).limit(1))[0]?.quantity).toBe(7);
  });

  it('leaves nothing behind when the receiving side refuses the goods', async () => {
    const data = await fixture();
    await database.insert(erpProducts).values({
      branchId: data.destinationBranchId, name: 'شامبو الأرغان',
      nameNormalized: (await database.select({ hash: erpProducts.nameNormalized })
        .from(erpProducts).where(eq(erpProducts.id, data.productId)).limit(1))[0]!.hash,
      sellingPrice: '95.00', lastPurchaseCost: '11.00', lowStockThreshold: 1, isActive: false,
      createdAt: at, updatedAt: at,
    });

    await expect(service().transfer(admin, {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      lines: [{ productId: data.productId, quantity: 2 }],
    })).rejects.toMatchObject({ code: 'TRANSFER_DESTINATION_PRODUCT_INACTIVE' });

    // The sale rolled back with it: no invoice, no stock moved, no transfer.
    expect(await database.select().from(invoices)
      .where(eq(invoices.branchId, data.sourceBranchId))).toHaveLength(0);
    expect((await database.select({ quantity: erpProductStocks.quantity })
      .from(erpProductStocks).where(and(
        eq(erpProductStocks.productId, data.productId),
        eq(erpProductStocks.branchId, data.sourceBranchId),
      )).limit(1))[0]?.quantity).toBe(10);
    expect(await database.select().from(erpStockTransfers)
      .where(eq(erpStockTransfers.destinationBranchId, data.destinationBranchId)))
      .toHaveLength(0);
  });

  it('refuses to move a product with no purchase cost recorded', async () => {
    const data = await fixture({ cost: '0.00' });

    await expect(service().transfer(admin, {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      lines: [{ productId: data.productId, quantity: 1 }],
    })).rejects.toMatchObject({ code: 'TRANSFER_COST_REQUIRED' });
  });

  it('needs an open shift at the sending branch', async () => {
    const data = await fixture();
    await database.update(cashierSessions)
      .set({ closedAt: at, closedByAccountId: admin.accountId })
      .where(eq(cashierSessions.branchId, data.sourceBranchId));

    await expect(service().transfer(admin, {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      lines: [{ productId: data.productId, quantity: 1 }],
    })).rejects.toMatchObject({ code: 'TRANSFER_SHIFT_REQUIRED' });
  });

  it('refuses to void or refund internal trade, in the service and in the database', async () => {
    const data = await fixture();
    const transfer = await service().transfer(admin, {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      lines: [{ productId: data.productId, quantity: 3 }],
    });
    const sales = createDrizzleSaleRepository(database, createErpAuditCapability());

    // Voiding would hand the stock back while the other branch still holds it.
    await expect(sales.reverse({
      type: 'void',
      invoiceId: transfer.invoiceId,
      input: {
        branchId: data.sourceBranchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'محاولة إلغاء تحويل',
      },
      actingAccountId: admin.accountId,
      actingAccountRole: 'admin',
      reversedAt: at,
    })).rejects.toMatchObject({ code: 'TRANSFER_NOT_REVERSIBLE' });

    // And the database refuses it even with the service bypassed entirely —
    // by the reversal-lifecycle guard here, by the transfer guard on the path
    // that writes a proper reversal row.
    const refused = await database.update(invoices).set({ status: 'voided' })
      .where(eq(invoices.id, transfer.invoiceId)).then(() => null, (error: unknown) => error);
    expect(refused).not.toBeNull();
    expect((await database.select({ status: invoices.status }).from(invoices)
      .where(eq(invoices.id, transfer.invoiceId)).limit(1))[0]?.status).toBe('completed');

    expect((await database.select({ quantity: erpProductStocks.quantity })
      .from(erpProductStocks).where(and(
        eq(erpProductStocks.productId, data.productId),
        eq(erpProductStocks.branchId, data.sourceBranchId),
      )).limit(1))[0]?.quantity).toBe(7);
  });

  it('marks the invoice as internal trade so reports can tell it apart', async () => {
    const data = await fixture();
    const transfer = await service().transfer(admin, {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      lines: [{ productId: data.productId, quantity: 1 }],
    });

    expect((await database.select({ kind: invoices.kind }).from(invoices)
      .where(eq(invoices.id, transfer.invoiceId)).limit(1))[0]?.kind)
      .toBe('branch_transfer');
  });

  it('lists a transfer under either branch it touched', async () => {
    const data = await fixture();
    const transfer = await service().transfer(admin, {
      idempotencyKey: crypto.randomUUID(),
      sourceBranchId: data.sourceBranchId,
      destinationBranchId: data.destinationBranchId,
      lines: [{ productId: data.productId, quantity: 1 }],
    });

    const fromSource = await service().list(admin, {
      branchId: data.sourceBranchId, page: 1, pageSize: 20,
    });
    const fromDestination = await service().list(admin, {
      branchId: data.destinationBranchId, page: 1, pageSize: 20,
    });

    expect(fromSource.items.map(({ id }) => id)).toContain(transfer.id);
    expect(fromDestination.items.map(({ id }) => id)).toContain(transfer.id);
    expect(fromSource.items[0]).toMatchObject({
      sourceBranchName: expect.stringContaining('source'),
      destinationBranchName: expect.stringContaining('destination'),
      invoiceNumber: expect.stringContaining('INV'),
    });
  });
});
