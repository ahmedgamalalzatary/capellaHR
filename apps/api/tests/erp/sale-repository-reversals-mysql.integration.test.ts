import {
  accounts,
  auditEvents,
  branchCashierRoster,
  branches,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  employees,
  erpCategories,
  erpProducts,
  erpProductStocks,
  erpStockMovements,
  erpServiceCommissionOverrides,
  erpServices,
  invoicePayments,
  invoiceReversalLines,
  invoiceReversalPayments,
  invoiceReversals,
  invoices,
  serviceQueueEntries,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import type { CompleteSaleOperation } from '../../src/modules/erp/sales/sale-service.js';

const database = createMysqlIntegrationDatabase();
const erp17Migration = readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/database/migrations/0056_confused_ulik.sql',
), 'utf8');
const erp17Backfill = erp17Migration.split('--> statement-breakpoint')
  .find((statement) => statement.includes('INSERT INTO `erp_commission_payroll_inputs`'))?.trim();
if (!erp17Backfill) throw new Error('ERP 17 commission backfill statement is missing');
const cairoBusinessDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((entry) => entry.type === type)!.value
  );
  return `${part('year')}-${part('month')}-${part('day')}`;
};

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
  it('partially refunds product quantities, restores stock, and remains idempotent', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '100.00' }];
    const completed = await repository.complete(sale);
    const key = crypto.randomUUID();
    const reversal = {
      type: 'refund' as const,
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: key,
        reason: 'Customer return',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash' as const, amount: '50.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier' as const,
      reversedAt: new Date('2026-08-03T12:00:00.000Z'),
    };

    const refunded = await repository.reverse(reversal);
    const retried = await repository.reverse(reversal);

    expect(refunded.status).toBe('partially_refunded');
    expect(retried).toEqual(refunded);
    expect((await database.select().from(erpProductStocks)
      .where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(1);
    expect(await database.select().from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id))).toHaveLength(1);
    expect(await database.select().from(invoiceReversalLines)
      .where(eq(invoiceReversalLines.invoiceId, completed.id))).toEqual([
      expect.objectContaining({ quantity: 1, grossAmount: '50.00', total: '50.00' }),
    ]);
    expect(await database.select().from(invoiceReversalPayments)).toEqual(expect.arrayContaining([
      expect.objectContaining({ methodSnapshot: 'cash', amount: '50.00' }),
    ]));
    expect(await database.select().from(erpStockMovements)
      .where(and(
        eq(erpStockMovements.reason, 'refund'),
        eq(erpStockMovements.sourceId, (await database.select({ id: invoiceReversals.id })
          .from(invoiceReversals).where(eq(invoiceReversals.invoiceId, completed.id)))[0]!.id),
      )))
      .toEqual([expect.objectContaining({ reason: 'refund', quantityDelta: 1, balanceAfter: 1 })]);
  });

  it('rejects a product reversal explicitly when its stock row is missing', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '50.00' }];
    const completed = await repository.complete(sale);
    await database.delete(erpProductStocks).where(and(
      eq(erpProductStocks.productId, data.productId),
      eq(erpProductStocks.branchId, data.branchId),
    ));

    await expect(repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Missing stock row',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '50.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-03T12:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    expect(await database.select().from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id))).toHaveLength(0);
  });

  it('voids a same-day service invoice and appends the exact commission reversal', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const now = new Date();
    const businessDate = cairoBusinessDate(now);
    const sale = operation(data, crypto.randomUUID());
    sale.soldAt = now;
    sale.invoiceNumber = `INV-${businessDate.replaceAll('-', '.')}-14.35-${data.branchId}`;
    // The sale happens now, so its shift must have been opened within the limit.
    await database.update(cashierSessions).set({ openedAt: now })
      .where(eq(cashierSessions.id, data.cashierSessionId));
    const completed = await repository.complete(sale);

    const voided = await repository.reverse({
      type: 'void',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Duplicate sale',
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: now,
    });

    expect(voided.status).toBe('voided');
    expect(await database.select({ status: serviceQueueEntries.status }).from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.invoiceId, completed.id)))
      .toEqual([expect.objectContaining({ status: 'canceled' })]);
    const reversalId = (await database.select({ id: invoiceReversals.id }).from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id)))[0]!.id;
    expect(await database.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.invoiceId, completed.id))).toEqual([
      expect.objectContaining({ entryType: 'earned', baseAmount: '200.00', amount: '30.00' }),
      expect.objectContaining({
        entryType: 'reversal', invoiceReversalId: reversalId,
        baseAmount: '200.00', amount: '-30.00',
      }),
    ]);
    expect(await database.select().from(auditEvents).where(and(
      eq(auditEvents.entityType, 'invoice'),
      eq(auditEvents.entityId, String(completed.id)),
      eq(auditEvents.action, 'void'),
    ))).toEqual([expect.objectContaining({
      relatedIds: expect.objectContaining({ actingAccountId: String(data.accountId) }),
    })]);
  });

  it('rejects a void exactly when the Cairo business date rolls over', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    await expect(repository.reverse({
      type: 'void',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Late cancellation',
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-03T22:30:00.000Z'),
    })).rejects.toMatchObject({ code: 'VOID_DATE_EXPIRED' });
    expect(await database.select().from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id))).toHaveLength(0);
  });

  it('allows an Admin to fully refund a completed invoice after the sale date', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    const refunded = await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Approved customer refund',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    expect(refunded.status).toBe('refunded');
    expect(refunded.reversals[0]).toMatchObject({
      actingAccount: { id: data.adminAccountId },
      approvingAccount: null,
    });
  });

  it('attributes a refund to the shift that handed the money back, or to none', async () => {
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const refundOwnInvoice = async (reversedAt: Date) => {
      const data = await fixture();
      const completed = await repository.complete(operation(data, crypto.randomUUID()));
      const refunded = await repository.reverse({
        type: 'refund',
        invoiceId: completed.id,
        input: {
          branchId: data.branchId,
          idempotencyKey: crypto.randomUUID(),
          reason: 'Approved customer refund',
          lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
          payments: [{ method: 'cash', amount: '185.00' }],
        },
        actingAccountId: data.adminAccountId,
        actingAccountRole: 'admin' as const,
        reversedAt,
      });
      const [stored] = await database.select().from(invoiceReversals)
        .where(eq(invoiceReversals.id, refunded.reversals[0]!.id));
      return { data, stored: stored! };
    };

    // Handed back while the till that sold it is still open: the same shift.
    const inside = await refundOwnInvoice(new Date('2026-08-03T11:36:00.000Z'));
    expect(inside.stored.cashierSessionId).toBe(inside.data.cashierSessionId);

    // A day later that shift has run past its sixteen hours and no till is open,
    // so the refund belongs to no shift rather than to a stale one.
    const outside = await refundOwnInvoice(new Date('2026-08-05T09:00:00.000Z'));
    expect(outside.stored.cashierSessionId).toBeNull();
  });

  it('hands the money back on a method the sale never used', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    const refunded = await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Client asked for the money on the card',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'visa', amount: '185.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    expect(refunded.reversals[0]!.payments).toEqual([{ method: 'visa', amount: '185.00' }]);
    // Nothing came off the cash the client actually paid, so that row stands untouched.
    expect(refunded.payments).toEqual([{
      method: 'cash', amount: '185.00',
      refundedAmount: '0.00', refundableAmount: '185.00',
    }]);
    const stored = await database.select().from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.reversalId, refunded.reversals[0]!.id));
    expect(stored).toEqual([expect.objectContaining({
      invoicePaymentId: null, methodSnapshot: 'visa', amount: '185.00',
    })]);
  });

  it('still links a refund to the payment it reverses when the method matches', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const [cashPayment] = await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, completed.id));

    const refunded = await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Cash back over the counter',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    expect(await database.select().from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.reversalId, refunded.reversals[0]!.id)))
      .toEqual([expect.objectContaining({ invoicePaymentId: cashPayment!.id })]);
    expect(refunded.payments[0]).toMatchObject({
      refundedAmount: '185.00', refundableAmount: '0.00',
    });
  });

  it('leaves a same-method refund unlinked when it no longer fits the original payment', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [
      { method: 'cash', amount: '30.00' },
      { method: 'visa', amount: '70.00' },
    ];
    const completed = await repository.complete(sale);

    const refunded = await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'All of it back in cash',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '50.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    // The first 30 is linked; only the excess 20 stands on its own.
    expect(await database.select().from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.reversalId, refunded.reversals[0]!.id)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ invoicePaymentId: expect.any(Number), amount: '30.00' }),
        expect.objectContaining({ invoicePaymentId: null, amount: '20.00' }),
      ]));
    expect(refunded.payments).toEqual([
      { method: 'cash', amount: '30.00', refundedAmount: '30.00', refundableAmount: '0.00' },
      { method: 'visa', amount: '70.00', refundedAmount: '0.00', refundableAmount: '70.00' },
    ]);
  });

  it('still refuses a refund payment linked to the wrong payment row', async () => {
    // The link is optional now, but a link that IS given must still be honest.
    // These are the two checks the rewritten insert guard has to keep making.
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    // A second fixture, because one fixture mints a single invoice number.
    const otherData = await fixture();
    const other = await repository.complete(operation(otherData, crypto.randomUUID()));
    const [otherPayment] = await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, other.id));
    const [ownPayment] = await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, completed.id));
    const pendingId = Number((await database.insert(invoiceReversals).values({
      invoiceId: completed.id, branchId: data.branchId, type: 'refund',
      idempotencyKey: crypto.randomUUID(), reason: 'Wrong payment link',
      actingAccountId: data.accountId, approvingAccountId: null,
      grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      businessDate: '2026-08-04', createdAt: new Date('2026-08-04T09:00:00.000Z'),
    }))[0].insertId);

    // Drizzle wraps the trigger's SIGNAL, so the guard is read off the cause.
    const guardMessage = async (invoicePaymentId: number, methodSnapshot: 'cash' | 'visa') => {
      try {
        await database.insert(invoiceReversalPayments).values({
          reversalId: pendingId, invoiceId: completed.id, invoicePaymentId, methodSnapshot,
          amount: '185.00', cashAmount: '185.00',
        });
        return 'accepted';
      } catch (error) {
        return String((error as { cause?: { message?: string } }).cause?.message ?? error);
      }
    };

    // A payment belonging to another invoice, then a link whose method disagrees
    // with the snapshot it is stored under.
    expect(await guardMessage(otherPayment!.id, 'cash'))
      .toMatch(/Invoice reversal payment ownership is invalid/);
    expect(await guardMessage(ownPayment!.id, 'visa'))
      .toMatch(/Invoice reversal payment ownership is invalid/);

    // The honest link is still accepted.
    await database.insert(invoiceReversalPayments).values({
      reversalId: pendingId, invoiceId: completed.id, invoicePaymentId: ownPayment!.id,
      methodSnapshot: 'cash', amount: '185.00', cashAmount: '185.00',
    });
    expect(await database.select().from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.reversalId, pendingId))).toHaveLength(1);
  });

  it('keeps counting an unlinked refund against the invoice, not against a payment', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [
      { method: 'cash', amount: '30.00' },
      { method: 'visa', amount: '70.00' },
    ];
    const completed = await repository.complete(sale);
    const refund = (key: string, method: 'cash' | 'visa', amount: string) => repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId, idempotencyKey: key, reason: 'Sequential return',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method, amount }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier' as const,
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    await refund(crypto.randomUUID(), 'cash', '50.00');
    const after = await refund(crypto.randomUUID(), 'visa', '50.00');

    // Both units are back, so nothing more can be refunded, even though the cash
    // Linked allocations reduce each original payment independently.
    expect(after.status).toBe('refunded');
    expect(after.eligibility.canRefund).toBe(false);
    expect(after.lines[0]).toMatchObject({ refundedQuantity: 2, refundableQuantity: 0 });
    expect(after.payments).toEqual([
      { method: 'cash', amount: '30.00', refundedAmount: '30.00', refundableAmount: '0.00' },
      { method: 'visa', amount: '70.00', refundedAmount: '50.00', refundableAmount: '20.00' },
    ]);
  });

  it('rejects a refund whose payment allocation does not equal its calculated total', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    await expect(repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Incorrect tender allocation',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '184.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'REFUND_PAYMENT_MISMATCH' });
    expect(await database.select().from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id))).toHaveLength(0);
  });

  it('serializes competing refunds so the same quantity is restored only once', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '50.00' }];
    const completed = await repository.complete(sale);
    const reverse = (key: string) => repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: key,
        reason: 'Concurrent return',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash' as const, amount: '50.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier' as const,
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    const results = await Promise.allSettled([
      reverse(crypto.randomUUID()),
      reverse(crypto.randomUUID()),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'INVOICE_NOT_REVERSIBLE' }) }),
    ]);
    expect((await database.select().from(erpProductStocks)
      .where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(2);
    expect(await database.select().from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id))).toHaveLength(1);
  });

  it('replays concurrent identical full-refund submissions from one stored reversal', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '50.00' }];
    const completed = await repository.complete(sale);
    const reversal = {
      type: 'refund' as const,
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Identical concurrent return',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash' as const, amount: '50.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier' as const,
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    };

    const results = await Promise.all([
      repository.reverse(reversal),
      repository.reverse(reversal),
    ]);

    expect(results[1]).toEqual(results[0]);
    expect(await database.select().from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id))).toHaveLength(1);
  });

  it('rejects cumulative quantities and tender amounts beyond the remaining refund caps', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '100.00' }];
    const completed = await repository.complete(sale);
    const reverse = (quantity: number, amount: string) => repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Cumulative cap check',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity }],
        payments: [{ method: 'cash' as const, amount }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier' as const,
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    await reverse(1, '50.00');
    await expect(reverse(2, '100.00'))
      .rejects.toMatchObject({ code: 'REFUND_QUANTITY_EXCEEDED' });
    // The method is free to choose, so the only cap left is the quoted total.
    await expect(reverse(1, '51.00'))
      .rejects.toMatchObject({ code: 'REFUND_PAYMENT_MISMATCH' });
    expect((await database.select().from(erpProductStocks)
      .where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(1);
    expect(await database.select().from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id))).toHaveLength(1);
  });

  it('rejects a Cashier whose active employee belongs to another branch', async () => {
    const invoiceBranch = await fixture();
    const otherBranch = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(invoiceBranch, crypto.randomUUID()));

    await expect(repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: invoiceBranch.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Cross-branch attempt',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: otherBranch.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'INVOICE_NOT_REVERSIBLE' });
    expect(await database.select().from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id))).toHaveLength(0);
  });

  it('blocks direct lifecycle shortcuts and mutation of stored reversal facts', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '100.00' }];
    const completed = await repository.complete(sale);

    await expect(database.update(invoices).set({ status: 'refunded' })
      .where(eq(invoices.id, completed.id))).rejects.toBeDefined();
    await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Guard proof',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '50.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });
    const reversal = (await database.select().from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id)))[0]!;
    await expect(database.update(invoiceReversals).set({ reason: 'tampered' })
      .where(eq(invoiceReversals.id, reversal.id))).rejects.toBeDefined();
  });

  it('rejects child inserts after finalization and incomplete direct product finalization', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [
      { itemType: 'product', productId: data.productId, quantity: 1 },
      { itemType: 'product', productId: data.productId, quantity: 1 },
    ];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '100.00' }];
    const completed = await repository.complete(sale);
    await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'First line return',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '50.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });
    const finalized = (await database.select().from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id)))[0]!;
    await expect(database.insert(invoiceReversalLines).values({
      reversalId: finalized.id,
      invoiceId: completed.id,
      invoiceLineId: completed.lines[1]!.id,
      branchId: data.branchId,
      quantity: 1,
      grossAmount: '50.00',
      discountAmount: '0.00',
      taxAmount: '0.00',
      total: '50.00',
    })).rejects.toBeDefined();

    const payment = (await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, completed.id)))[0]!;
    const pendingId = Number((await database.insert(invoiceReversals).values({
      invoiceId: completed.id,
      branchId: data.branchId,
      type: 'refund',
      idempotencyKey: crypto.randomUUID(),
      reason: 'Missing stock movement',
      actingAccountId: data.accountId,
      approvingAccountId: null,
      grossAmount: '50.00', discountAmount: '0.00', taxAmount: '0.00', total: '50.00',
      businessDate: '2026-08-04',
      createdAt: new Date('2026-08-04T09:00:00.000Z'),
    }))[0].insertId);
    await database.insert(invoiceReversalLines).values({
      reversalId: pendingId, invoiceId: completed.id,
      invoiceLineId: completed.lines[1]!.id, branchId: data.branchId,
      quantity: 1, grossAmount: '50.00', discountAmount: '0.00', taxAmount: '0.00', total: '50.00',
    });
    await database.insert(invoiceReversalPayments).values({
      reversalId: pendingId, invoiceId: completed.id, invoicePaymentId: payment.id,
      methodSnapshot: 'cash', amount: '50.00', cashAmount: '50.00',
    });
    await expect(database.update(invoiceReversals).set({ status: 'finalized' })
      .where(eq(invoiceReversals.id, pendingId))).rejects.toBeDefined();
    expect((await database.select().from(invoices)
      .where(eq(invoices.id, completed.id)))[0]?.status).toBe('partially_refunded');
  });

  it('rejects a direct void whose Cairo business date differs from its invoice number', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    await expect(database.insert(invoiceReversals).values({
      invoiceId: completed.id,
      branchId: data.branchId,
      type: 'void',
      idempotencyKey: crypto.randomUUID(),
      reason: 'Late direct void',
      actingAccountId: data.accountId,
      approvingAccountId: null,
      grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      businessDate: '2026-08-04',
      createdAt: new Date('2026-08-04T09:00:00.000Z'),
    })).rejects.toBeDefined();
  });

  it('rejects finalizing a service refund without its linked commission reversal', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const payment = (await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, completed.id)))[0]!;
    const pendingId = Number((await database.insert(invoiceReversals).values({
      invoiceId: completed.id,
      branchId: data.branchId,
      type: 'refund',
      idempotencyKey: crypto.randomUUID(),
      reason: 'Missing commission reversal',
      actingAccountId: data.accountId,
      approvingAccountId: null,
      grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      businessDate: '2026-08-04',
      createdAt: new Date('2026-08-04T09:00:00.000Z'),
    }))[0].insertId);
    await database.insert(invoiceReversalLines).values({
      reversalId: pendingId,
      invoiceId: completed.id,
      invoiceLineId: completed.lines[0]!.id,
      branchId: data.branchId,
      quantity: 1,
      grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
    });
    await database.insert(invoiceReversalPayments).values({
      reversalId: pendingId,
      invoiceId: completed.id,
      invoicePaymentId: payment.id,
      methodSnapshot: payment.method,
      amount: '185.00',
      cashAmount: '185.00',
    });

    await expect(database.update(invoiceReversals).set({ status: 'finalized' })
      .where(eq(invoiceReversals.id, pendingId))).rejects.toBeDefined();
    expect((await database.select().from(invoices)
      .where(eq(invoices.id, completed.id)))[0]?.status).toBe('completed');
  });

  it('rejects reversal money that is not the exact allocation for its selected quantity', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '50.00' }];
    const completed = await repository.complete(sale);
    const payment = (await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, completed.id)))[0]!;
    const pendingId = Number((await database.insert(invoiceReversals).values({
      invoiceId: completed.id, branchId: data.branchId, type: 'refund',
      idempotencyKey: crypto.randomUUID(), reason: 'Arbitrary direct amount',
      actingAccountId: data.accountId, approvingAccountId: null,
      grossAmount: '1.00', discountAmount: '0.00', taxAmount: '0.00', total: '1.00',
      businessDate: '2026-08-04', createdAt: new Date('2026-08-04T09:00:00.000Z'),
    }))[0].insertId);
    await database.insert(invoiceReversalLines).values({
      reversalId: pendingId, invoiceId: completed.id,
      invoiceLineId: completed.lines[0]!.id, branchId: data.branchId,
      quantity: 1, grossAmount: '1.00', discountAmount: '0.00', taxAmount: '0.00', total: '1.00',
    });
    await database.insert(invoiceReversalPayments).values({
      reversalId: pendingId, invoiceId: completed.id, invoicePaymentId: payment.id,
      methodSnapshot: 'cash', amount: '1.00', cashAmount: '1.00',
    });
    await database.update(erpProductStocks).set({ quantity: 2 })
      .where(eq(erpProductStocks.productId, data.productId));
    await database.insert(erpStockMovements).values({
      productId: data.productId, branchId: data.branchId,
      reason: 'refund', sourceType: 'refund', sourceId: pendingId,
      quantityDelta: 1, balanceAfter: 2, actingAccountId: data.accountId,
      createdAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    await expect(database.update(invoiceReversals).set({ status: 'finalized' })
      .where(eq(invoiceReversals.id, pendingId))).rejects.toBeDefined();
  });

  it('rejects stock restoration movements whose recorded balance was not persisted', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '50.00' }];
    const completed = await repository.complete(sale);
    const payment = (await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, completed.id)))[0]!;
    const pendingId = Number((await database.insert(invoiceReversals).values({
      invoiceId: completed.id, branchId: data.branchId, type: 'refund',
      idempotencyKey: crypto.randomUUID(), reason: 'Movement without stock update',
      actingAccountId: data.accountId, approvingAccountId: null,
      grossAmount: '50.00', discountAmount: '0.00', taxAmount: '0.00', total: '50.00',
      businessDate: '2026-08-04', createdAt: new Date('2026-08-04T09:00:00.000Z'),
    }))[0].insertId);
    await database.insert(invoiceReversalLines).values({
      reversalId: pendingId, invoiceId: completed.id,
      invoiceLineId: completed.lines[0]!.id, branchId: data.branchId,
      quantity: 1, grossAmount: '50.00', discountAmount: '0.00', taxAmount: '0.00', total: '50.00',
    });
    await database.insert(invoiceReversalPayments).values({
      reversalId: pendingId, invoiceId: completed.id, invoicePaymentId: payment.id,
      methodSnapshot: 'cash', amount: '50.00', cashAmount: '50.00',
    });
    await database.insert(erpStockMovements).values({
      productId: data.productId, branchId: data.branchId,
      reason: 'refund', sourceType: 'refund', sourceId: pendingId,
      quantityDelta: 1, balanceAfter: 2, actingAccountId: data.accountId,
      createdAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    await expect(database.update(invoiceReversals).set({ status: 'finalized' })
      .where(eq(invoiceReversals.id, pendingId))).rejects.toBeDefined();
  });

});
