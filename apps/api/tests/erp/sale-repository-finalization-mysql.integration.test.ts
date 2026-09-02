import {
  accounts,
  auditEvents,
  branchCashierRoster,
  branches,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  employees,
  erpCommissionPayrollInputs,
  erpCategories,
  erpProducts,
  erpProductStocks,
  erpStockMovements,
  erpServiceCommissionOverrides,
  erpServices,
  invoiceLines,
  invoicePayments,
  invoiceReversalLines,
  invoiceReversalPayments,
  invoiceReversals,
  invoices,
} from '@capella/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { createDrizzleProductStockRepository } from '../../src/modules/erp/stock/index.js';
import { createDrizzleInvoiceSequenceStore } from '../../src/modules/erp/sales/invoice-sequence-store.js';
import type { CompleteSaleOperation } from '../../src/modules/erp/sales/sale-service.js';
import { createErpPayrollCapability } from '../../src/modules/payroll/index.js';

const database = createMysqlIntegrationDatabase();
const erp17Migration = readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/database/migrations/0056_confused_ulik.sql',
), 'utf8');
const erp17Backfill = erp17Migration.split('--> statement-breakpoint')
  .find((statement) => statement.includes('INSERT INTO `erp_commission_payroll_inputs`'))?.trim();
if (!erp17Backfill) throw new Error('ERP 17 commission backfill statement is missing');
beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  const at = new Date('2026-08-03T11:35:00.000Z');
  await database.insert(accounts).values({
    username: 'erp9-isolated-admin',
    passwordHash: 'unused',
    role: 'admin',
    createdAt: at,
    updatedAt: at,
  });
}, 120_000);

afterAll(async () => {
  await closeMysqlIntegrationDatabase(database);
}, 30_000);
let sequence = 0;
const fixture = async () => {
  sequence += 1;
  const uniqueNumber = Math.floor(Math.random() * 80_000_000) + 10_000_000;
  const employeeCode = 1_500_000_000 + uniqueNumber;
  const marker = `erp9-${process.pid}-${Date.now()}-${uniqueNumber}-${sequence}`;
  const clientPhone = `012${uniqueNumber}`;
  const at = new Date('2026-08-03T11:35:00.000Z');
  const branchId = Number((await database.insert(branches).values({
    name: marker,
    nameNormalized: marker,
    location: 'Cairo',
    latitude: 30,
    longitude: 31,
    gpsAccuracyMeters: 5,
    attendanceRadiusMeters: 100,
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const employeeId = Number((await database.insert(employees).values({
    employeeCode,
    fullName: `Employee ${marker}`,
    personalPhone: `010${uniqueNumber}`,
    whatsappPhone: `011${uniqueNumber}`,
    pinHash: 'unused',
    age: 30,
    address: 'Cairo',
    branchId,
    shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00',
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const sellerEmployeeId = Number((await database.insert(employees).values({
    employeeCode: employeeCode + 1,
    fullName: `Seller ${marker}`,
    personalPhone: `015${uniqueNumber}`,
    whatsappPhone: `015${uniqueNumber}`,
    pinHash: 'unused',
    age: 30,
    address: 'Cairo',
    branchId,
    shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00',
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  await database.insert(branchCashierRoster).values({ branchId, employeeId: sellerEmployeeId, createdAt: at });
  const accountId = Number((await database.insert(accounts).values({
    username: marker,
    passwordHash: 'unused',
    role: 'cashier',
    branchId,
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const adminAccountId = (await database.select({ id: accounts.id }).from(accounts)
    .where(eq(accounts.role, 'admin')).limit(1))[0]!.id;
  const clientId = Number((await database.insert(clients).values({
    branchId,
    fullName: `Client ${marker}`,
    phone: clientPhone,
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const categoryId = Number((await database.insert(erpCategories).values({
    branchId,
    type: 'service',
    name: `Category ${marker}`,
    nameNormalized: `category-${marker}`,
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const serviceId = Number((await database.insert(erpServices).values({
    branchId,
    categoryId,
    name: `Service ${marker}`,
    nameNormalized: `service-${marker}`,
    price: '200.00',
    commissionPercent: '10.00',
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const productId = Number((await database.insert(erpProducts).values({
    branchId, name: `Product ${marker}`, nameNormalized: `product-${marker}`,
    sellingPrice: '50.00', lastPurchaseCost: '30.00', lowStockThreshold: 1,
    createdAt: at, updatedAt: at,
  }))[0].insertId);
  await database.insert(erpProductStocks).values({ productId, branchId, quantity: 2, updatedAt: at });
  await database.insert(erpServiceCommissionOverrides).values({
    serviceId,
    employeeId,
    commissionPercent: '15.00',
    createdAt: at,
    updatedAt: at,
  });
  const cashierSessionId = Number((await database.insert(cashierSessions).values({
    branchId,
    openedByAccountId: accountId,
    openedAt: at,
  }))[0].insertId);
  return {
    marker, clientPhone, at, branchId, employeeId, employeeCode, sellerEmployeeId,
    accountId, adminAccountId,
    clientId, serviceId, productId, cashierSessionId,
  };
};

const operation = (data: Awaited<ReturnType<typeof fixture>>, key: string): CompleteSaleOperation => ({
  input: {
    branchId: data.branchId,
    clientId: data.clientId,
    sellerEmployeeId: data.sellerEmployeeId,
    cashierSessionId: data.cashierSessionId,
    idempotencyKey: key,
    lines: [{
      itemType: 'service' as const,
      serviceId: data.serviceId,
      quantity: 1,
      unitPrice: '200.00',
      employeeId: data.employeeId,
    }],
    discount: { kind: 'percentage' as const, value: '10.00' },
    tax: { kind: 'fixed' as const, value: '5.00' },
    payments: [{ method: 'cash' as const, amount: '185.00' }],
  },
  actingAccountId: data.accountId,
  actingAccountRole: 'cashier' as const,
  invoiceNumber: `INV-2026.08.03-14.35-${data.branchId}`,
  soldAt: data.at,
  assertEmployees: async () => [{
    id: data.employeeId,
    employeeCode: data.employeeCode,
    fullName: `Employee ${data.marker}`,
    branchId: data.branchId,
  }],
});

describe('ERP sale repository MySQL integration', () => {
  it('rejects a historical void whose supplied business date hides its current creation date', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    await expect(database.insert(invoiceReversals).values({
      invoiceId: completed.id, branchId: data.branchId, type: 'void',
      idempotencyKey: crypto.randomUUID(), reason: 'Backdated direct void',
      actingAccountId: data.accountId, approvingAccountId: null,
      grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      businessDate: '2026-08-03', createdAt: new Date(),
    })).rejects.toBeDefined();
  });

  it('finalizes one service refund without counting another pending reversal commission', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const payment = (await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, completed.id)))[0]!;
    const earned = (await database.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.invoiceId, completed.id)))[0]!;
    const makePending = async (reason: string) => {
      const reversalId = Number((await database.insert(invoiceReversals).values({
        invoiceId: completed.id, branchId: data.branchId, type: 'refund',
        idempotencyKey: crypto.randomUUID(), reason,
        actingAccountId: data.accountId, approvingAccountId: null,
        grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
        businessDate: '2026-08-04', createdAt: new Date('2026-08-04T09:00:00.000Z'),
      }))[0].insertId);
      await database.insert(invoiceReversalLines).values({
        reversalId, invoiceId: completed.id, invoiceLineId: completed.lines[0]!.id,
        branchId: data.branchId, quantity: 1,
        grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      });
      await database.insert(invoiceReversalPayments).values({
        reversalId, invoiceId: completed.id, invoicePaymentId: payment.id,
        methodSnapshot: 'cash', amount: '185.00', cashAmount: '185.00',
      });
      await database.insert(commissionLedgerEntries).values({
        invoiceId: completed.id, invoiceLineId: completed.lines[0]!.id,
        employeeId: data.employeeId, actingAccountId: data.accountId,
        entryType: 'reversal', reversesEntryId: earned.id, invoiceReversalId: reversalId,
        commissionRuleSnapshot: earned.commissionRuleSnapshot,
        commissionRateSnapshot: earned.commissionRateSnapshot,
        baseAmount: '200.00', amount: '-30.00', createdAt: new Date('2026-08-04T09:00:00.000Z'),
      });
      return reversalId;
    };
    const firstId = await makePending('First pending refund');
    await makePending('Second pending refund');

    await expect(database.update(invoiceReversals).set({ status: 'finalized' })
      .where(eq(invoiceReversals.id, firstId))).resolves.toBeDefined();
  });

  it('reconciles rounding when partial reversals finalize in reverse insertion order', async () => {
    const data = await fixture();
    await database.update(erpServices).set({ price: '0.10' })
      .where(eq(erpServices.id, data.serviceId));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{
      itemType: 'service', serviceId: data.serviceId, quantity: 3, unitPrice: '0.10',
      employeeId: data.employeeId,
    }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '0.30' }];
    const completed = await repository.complete(sale);
    const line = completed.lines[0]!;
    const payment = (await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, completed.id)))[0]!;
    const earned = (await database.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.invoiceId, completed.id)))[0]!;
    const insertPending = async (reason: string) => {
      const reversalId = Number((await database.insert(invoiceReversals).values({
        invoiceId: completed.id, branchId: data.branchId, type: 'refund',
        idempotencyKey: crypto.randomUUID(), reason,
        actingAccountId: data.accountId, approvingAccountId: null,
        grossAmount: '0.10', discountAmount: '0.00', taxAmount: '0.00', total: '0.10',
        businessDate: '2026-08-04', createdAt: new Date('2026-08-04T09:00:00.000Z'),
      }))[0].insertId);
      await database.insert(invoiceReversalLines).values({
        reversalId, invoiceId: completed.id, invoiceLineId: line.id,
        branchId: data.branchId, quantity: 1,
        grossAmount: '0.10', discountAmount: '0.00', taxAmount: '0.00', total: '0.10',
      });
      await database.insert(invoiceReversalPayments).values({
        reversalId, invoiceId: completed.id, invoicePaymentId: payment.id,
        methodSnapshot: 'cash', amount: '0.10', cashAmount: '0.10',
      });
      return reversalId;
    };
    const lowerReversalId = await insertPending('Inserted first, finalized second');
    const higherReversalId = await insertPending('Inserted second, finalized first');

    await database.insert(commissionLedgerEntries).values({
      id: 2_000_002,
      invoiceId: completed.id, invoiceLineId: line.id, employeeId: data.employeeId,
      actingAccountId: data.accountId, entryType: 'reversal', reversesEntryId: earned.id,
      invoiceReversalId: higherReversalId,
      commissionRuleSnapshot: earned.commissionRuleSnapshot,
      commissionRateSnapshot: earned.commissionRateSnapshot,
      baseAmount: '0.10', amount: '-0.02', createdAt: new Date('2026-08-04T09:01:00.000Z'),
    });
    await database.update(invoiceReversals).set({ status: 'finalized' })
      .where(eq(invoiceReversals.id, higherReversalId));

    await database.insert(commissionLedgerEntries).values({
      id: 2_000_001,
      invoiceId: completed.id, invoiceLineId: line.id, employeeId: data.employeeId,
      actingAccountId: data.accountId, entryType: 'reversal', reversesEntryId: earned.id,
      invoiceReversalId: lowerReversalId,
      commissionRuleSnapshot: earned.commissionRuleSnapshot,
      commissionRateSnapshot: earned.commissionRateSnapshot,
      baseAmount: '0.10', amount: '-0.01', createdAt: new Date('2026-08-04T09:02:00.000Z'),
    });
    await expect(database.update(invoiceReversals).set({ status: 'finalized' })
      .where(eq(invoiceReversals.id, lowerReversalId))).resolves.toBeDefined();

    const [reconciliation] = await database.select({
      quantity: sql<string>`SUM(${invoiceReversalLines.quantity})`,
      baseAmount: sql<string>`SUM(${commissionLedgerEntries.baseAmount})`,
      commission: sql<string>`SUM(${commissionLedgerEntries.amount})`,
    }).from(invoiceReversalLines)
      .innerJoin(commissionLedgerEntries, and(
        eq(commissionLedgerEntries.invoiceReversalId, invoiceReversalLines.reversalId),
        eq(commissionLedgerEntries.invoiceLineId, invoiceReversalLines.invoiceLineId),
      ))
      .where(eq(invoiceReversalLines.invoiceId, completed.id));
    expect(reconciliation).toEqual({ quantity: '2', baseAmount: '0.20', commission: '-0.03' });
  });

  it('fully refunds a zero-net product line without creating a payment movement', async () => {
    const data = await fixture();
    await database.update(erpProducts).set({ sellingPrice: '0.01' })
      .where(eq(erpProducts.id, data.productId));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [
      { itemType: 'product', productId: data.productId, quantity: 1 },
      { itemType: 'product', productId: data.productId, quantity: 1 },
    ];
    sale.input.discount = { kind: 'fixed', value: '0.01' };
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '0.01' }];
    const completed = await repository.complete(sale);

    const first = await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Fully discounted item',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });
    expect(first.status).toBe('partially_refunded');
    expect(first.reversals[0]).toMatchObject({ totals: { total: '0.00' }, payments: [] });

    const second = await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Remaining cent',
        lines: [{ invoiceLineId: completed.lines[1]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '0.01' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:01:00.000Z'),
    });
    expect(second.status).toBe('refunded');
    expect((await database.select().from(erpProductStocks)
      .where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(2);
  });

  it('rolls back every reversal fact when audit persistence fails', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '50.00' }];
    const completed = await repository.complete(sale);
    await database.execute(sql.raw("CREATE TRIGGER `erp16_fail_audit` BEFORE INSERT ON `audit_events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced ERP 16 rollback'"));
    try {
      await expect(repository.reverse({
        type: 'refund',
        invoiceId: completed.id,
        input: {
          branchId: data.branchId,
          idempotencyKey: crypto.randomUUID(),
          reason: 'Rollback proof',
          lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
          payments: [{ method: 'cash', amount: '50.00' }],
        },
        actingAccountId: data.accountId,
        actingAccountRole: 'cashier',
        reversedAt: new Date('2026-08-04T09:00:00.000Z'),
      })).rejects.toBeDefined();
      expect((await database.select().from(invoices)
        .where(eq(invoices.id, completed.id)))[0]?.status).toBe('completed');
      expect((await database.select().from(erpProductStocks)
        .where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(1);
      expect(await database.select().from(invoiceReversals)
        .where(eq(invoiceReversals.invoiceId, completed.id))).toHaveLength(0);
      expect(await database.select().from(erpStockMovements).where(and(
        eq(erpStockMovements.reason, 'refund'),
        eq(erpStockMovements.productId, data.productId),
      ))).toHaveLength(0);
    } finally {
      await database.execute(sql.raw('DROP TRIGGER IF EXISTS `erp16_fail_audit`'));
    }
  });

  it('rejects impossible stock movement reason, source, and direction facts', async () => {
    const data = await fixture();
    const base = {
      productId: data.productId, branchId: data.branchId, sourceId: 99,
      balanceAfter: 2, actingAccountId: data.accountId, createdAt: data.at,
    };

    await expect(database.insert(erpStockMovements).values({
      ...base, reason: 'sale', sourceType: 'purchase', quantityDelta: -1,
    })).rejects.toBeDefined();
    await expect(database.insert(erpStockMovements).values({
      ...base, reason: 'sale', sourceType: 'sale', quantityDelta: 1,
    })).rejects.toBeDefined();
  });

  it('creates and adjusts product stock atomically with audit history', async () => {
    const data = await fixture();
    const repository = createDrizzleProductStockRepository(database, createErpAuditCapability(), () => data.at);
    const product = await repository.create({
      branchId: data.branchId, name: `Stock ${data.marker}`, nameNormalized: `stock-${data.marker}`,
      description: null, sellingPrice: '100.00', lastPurchaseCost: '60.00',
      lowStockThreshold: 2, barcode: null, isActive: true, openingQuantity: 0,
    }, data.adminAccountId);
    const adjusted = await repository.adjust(product.id, data.branchId, {
      branchId: data.branchId, quantityDelta: 5, reason: 'count_correction', note: 'opening count',
    }, data.adminAccountId);
    expect(adjusted.product.quantity).toBe(5);
    await expect(repository.adjust(product.id, data.branchId, {
      branchId: data.branchId, quantityDelta: -6, reason: 'damage',
    }, data.adminAccountId)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(await database.select().from(auditEvents).where(eq(auditEvents.entityId, String(product.id)))).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: 'erp-stock', action: 'create' }),
      expect.objectContaining({ module: 'erp-stock', action: 'adjust' }),
    ]));
  });

  it('decrements product stock, snapshots cost, records movement, and earns seller commission', async () => {
    const data = await fixture();
    await database.update(erpProducts).set({ commissionPercent: '10.00' }).where(eq(erpProducts.id, data.productId));
    const repository = createDrizzleSaleRepository(
      database, createErpAuditCapability(), createErpPayrollCapability(database),
    );
    await expect(repository.quote(data.branchId, {
      lines: [{ itemType: 'product', productId: data.productId, quantity: 1 }],
    })).resolves.toMatchObject({
      lines: [{ itemType: 'product', commissionPercent: '10.00' }],
    });
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    delete request.assertEmployees;
    delete request.input.discount;
    delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '100.00' }];
    const result = await repository.complete(request);

    expect(result.lines[0]).toMatchObject({ sourceId: data.productId, employee: expect.objectContaining({ id: data.sellerEmployeeId }), productCostBasis: '30.00', commissionRule: 'service_default', commissionRate: '10.00', commissionAmount: '10.00' });
    expect((await database.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, result.id)))[0])
      .toMatchObject({
        employeeId: data.sellerEmployeeId,
      });
    expect((await database.select().from(erpProductStocks).where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(0);
    expect(await database.select().from(erpStockMovements).where(and(
      eq(erpStockMovements.sourceId, result.id),
      eq(erpStockMovements.productId, data.productId),
    ))).toEqual([
      expect.objectContaining({ productId: data.productId, reason: 'sale', quantityDelta: -2, balanceAfter: 0 }),
    ]);
    expect(await database.select().from(commissionLedgerEntries).where(eq(commissionLedgerEntries.invoiceId, result.id))).toHaveLength(1);
    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, data.sellerEmployeeId),
    )).toEqual([expect.objectContaining({ amount: '10.00' })]);
    await expect(repository.listInvoices(data.branchId, { page: 1, pageSize: 20 }))
      .resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ id: result.id, employees: [{ id: data.sellerEmployeeId, name: expect.any(String) }] }),
        ]),
      });
    await expect(repository.listClientVisits(data.branchId, data.clientId, { page: 1, pageSize: 20 }))
      .resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ id: result.id, employees: [{ id: data.sellerEmployeeId, name: expect.any(String) }] }),
        ]),
      });
    await expect(repository.findByIdempotencyKey(request.input.idempotencyKey, {
      actingAccountId: request.actingAccountId,
      actingAccountRole: request.actingAccountRole,
    })).resolves.toMatchObject({
      input: request.input,
      invoice: { id: result.id },
    });
  });

  it('reverses seller commission and payroll when a commissioned product is refunded', async () => {
    const data = await fixture();
    await database.update(erpProducts).set({ commissionPercent: '10.00' })
      .where(eq(erpProducts.id, data.productId));
    const repository = createDrizzleSaleRepository(
      database, createErpAuditCapability(), createErpPayrollCapability(database),
    );
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    delete request.assertEmployees;
    delete request.input.discount;
    delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '100.00' }];
    const completed = await repository.complete(request);

    await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Returned commissioned products',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 2 }],
        payments: [{ method: 'cash', amount: '100.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      reversedAt: new Date('2026-08-03T12:05:00.000Z'),
    });

    expect(await database.select().from(commissionLedgerEntries).where(and(
      eq(commissionLedgerEntries.invoiceId, completed.id),
      eq(commissionLedgerEntries.entryType, 'reversal'),
    ))).toEqual([expect.objectContaining({
      employeeId: data.sellerEmployeeId,
      amount: '-10.00',
    })]);
    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, data.sellerEmployeeId),
    )).toEqual([expect.objectContaining({ amount: '0.00' })]);
  });

  it('allows only one concurrent sale of the last product unit', async () => {
    const data = await fixture();
    await database.update(erpProductStocks).set({ quantity: 1 }).where(eq(erpProductStocks.productId, data.productId));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const productOperation = (key: string) => {
      const request = operation(data, key);
      request.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1 }];
      delete request.input.discount;
      delete request.input.tax;
      request.input.payments = [{ method: 'cash', amount: '50.00' }];
      request.invoiceNumber += `-${key.slice(0, 4)}`;
      return request;
    };
    const results = await Promise.allSettled([
      repository.complete(productOperation(crypto.randomUUID())),
      repository.complete(productOperation(crypto.randomUUID())),
    ]);
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((value) => value.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'INSUFFICIENT_STOCK' }) }),
    ]);
  });

  it('rejects cumulative duplicate product lines that exceed one locked balance', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [
      { itemType: 'product', productId: data.productId, quantity: 1 },
      { itemType: 'product', productId: data.productId, quantity: 2 },
    ];
    delete request.input.discount; delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '150.00' }];
    await expect(repository.complete(request)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect((await database.select().from(erpProductStocks).where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(2);
  });

  it('allocates unique gap-safe daily invoice sequences under concurrency', async () => {
    const store = createDrizzleInvoiceSequenceStore(database);
    const allocatedAt = new Date('2026-08-04T09:00:00.000Z');
    const values = await Promise.all(Array.from(
      { length: 20 },
      () => store.allocate('2026-08-04', allocatedAt),
    ));
    expect([...values].sort((left, right) => left - right))
      .toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

});
