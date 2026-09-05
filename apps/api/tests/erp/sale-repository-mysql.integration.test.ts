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
  erpPostPayrollDeductions,
  erpCategories,
  erpProducts,
  erpProductStocks,
  erpServiceCommissionOverrides,
  erpServices,
  invoiceLineReassignments,
  invoicePayments,
  invoiceReversalPayments,
  invoices,
  payrollMonths,
} from '@capella/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleCommissionRepository } from '../../src/modules/erp/commissions/index.js';
import { createDrizzleCashierSessionRepository } from '../../src/modules/erp/sales/cashier-sessions-repository.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { createDrizzleBranchCashierRosterRepository } from '../../src/modules/erp/sales/branch-cashier-roster-repository.js';
import type { CompleteSaleOperation, ReverseInvoiceOperation } from '../../src/modules/erp/sales/sale-service.js';
import { createErpPayrollCapability, type ErpPayrollCapability } from '../../src/modules/payroll/index.js';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

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
  it('allocates consecutive queue numbers per service and resets them with the cashier shift', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const firstSale = operation(data, crypto.randomUUID());
    firstSale.input.lines[0] = { ...firstSale.input.lines[0]!, quantity: 3 };
    firstSale.input.payments = [{ method: 'cash', amount: '545.00' }];
    const first = await repository.complete(firstSale);
    expect(first.lines[0]?.queueNumbers).toEqual([1, 2, 3]);

    const secondSale = operation(data, crypto.randomUUID());
    secondSale.invoiceNumber = `${firstSale.invoiceNumber}-2`;
    secondSale.input.lines[0] = { ...secondSale.input.lines[0]!, quantity: 2 };
    secondSale.input.payments = [{ method: 'cash', amount: '365.00' }];
    const second = await repository.complete(secondSale);
    expect(second.lines[0]?.queueNumbers).toEqual([4, 5]);

    await database.update(cashierSessions).set({
      closedAt: data.at,
      closedByAccountId: data.accountId,
    }).where(eq(cashierSessions.id, data.cashierSessionId));
    const nextSessionId = Number((await database.insert(cashierSessions).values({
      branchId: data.branchId,
      openedByAccountId: data.accountId,
      openedAt: data.at,
    }))[0].insertId);
    const nextShiftSale = operation(data, crypto.randomUUID());
    nextShiftSale.invoiceNumber = `${firstSale.invoiceNumber}-3`;
    nextShiftSale.input.cashierSessionId = nextSessionId;
    const nextShift = await repository.complete(nextShiftSale);
    expect(nextShift.lines[0]?.queueNumbers).toEqual([1]);
  });

  it('records one concurrent idempotent instalment on a product-only invoice', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '30.00' }];
    const open = await repository.complete(sale);
    expect(open.totals).toMatchObject({ amountPaid: '30.00', balanceDue: '70.00', settlementStatus: 'open' });

    const payment = {
      invoiceId: open.id,
      input: {
        branchId: data.branchId, cashierSessionId: data.cashierSessionId,
        method: 'cash' as const, amount: '20.00', operationReference: crypto.randomUUID(),
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier' as const,
      paidAt: new Date(data.at.getTime() + 60_000),
    };
    const [first, retry] = await Promise.all([
      repository.recordPayment(payment), repository.recordPayment(payment),
    ]);
    expect(first.totals).toMatchObject({ amountPaid: '50.00', balanceDue: '50.00', settlementStatus: 'open' });
    expect(retry.totals).toEqual(first.totals);
    expect(await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, open.id))).toHaveLength(2);
    await expect(repository.findByIdempotencyKey(sale.input.idempotencyKey, {
      actingAccountId: data.accountId, actingAccountRole: 'cashier',
    })).resolves.toMatchObject({ input: { payments: [{ method: 'cash', amount: '30.00' }] } });
    await expect(repository.recordPayment({
      ...payment, input: { ...payment.input, amount: '69.00' },
    })).rejects.toEqual(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    await expect(repository.recordPayment({
      ...payment, input: { ...payment.input, amount: '51.00', operationReference: crypto.randomUUID() },
    })).rejects.toEqual(expect.objectContaining({ code: 'PAYMENT_EXCEEDS_BALANCE' }));
    const settled = await repository.recordPayment({
      ...payment, input: { ...payment.input, amount: '50.00', operationReference: crypto.randomUUID() },
    });
    expect(settled.totals).toMatchObject({ amountPaid: '100.00', balanceDue: '0.00', settlementStatus: 'settled' });
    expect(await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, open.id))).toHaveLength(3);
  });

  it('credits product returns against debt before paying cash back', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '30.00' }];
    const open = await repository.complete(sale);
    const line = open.lines[0]!;
    const firstRefund = {
      type: 'refund', invoiceId: open.id,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'First return',
        lines: [{ invoiceLineId: line.id, quantity: 1 }], payments: [],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date(data.at.getTime() + 60_000),
    } satisfies ReverseInvoiceOperation;
    const first = await repository.reverse(firstRefund);
    expect(first.totals).toMatchObject({
      amountPaid: '30.00', creditedAmount: '50.00', balanceDue: '20.00', settlementStatus: 'open',
    });
    await expect(repository.reverse(firstRefund)).resolves.toEqual(first);
    const second = await repository.reverse({
      type: 'refund', invoiceId: open.id,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'Second return',
        lines: [{ invoiceLineId: line.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '30.00' }],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date(data.at.getTime() + 120_000),
    });
    expect(second.totals).toMatchObject({
      amountPaid: '0.00', creditedAmount: '100.00', balanceDue: '0.00', settlementStatus: 'settled',
    });
  });

  it('preserves each original payment link when one refund spans repeated methods', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '30.00' }];
    const open = await repository.complete(sale);
    const paid = await repository.recordPayment({
      invoiceId: open.id,
      input: {
        branchId: data.branchId,
        cashierSessionId: data.cashierSessionId,
        method: 'cash',
        amount: '70.00',
        operationReference: crypto.randomUUID(),
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      paidAt: new Date(data.at.getTime() + 60_000),
    });

    const refunded = await repository.reverse({
      type: 'refund',
      invoiceId: paid.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Return spanning two cash instalments',
        lines: [{ invoiceLineId: paid.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '50.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      reversedAt: new Date(data.at.getTime() + 120_000),
    });

    expect(refunded.payments).toEqual([
      { method: 'cash', amount: '30.00', refundedAmount: '30.00', refundableAmount: '0.00' },
      { method: 'cash', amount: '70.00', refundedAmount: '20.00', refundableAmount: '50.00' },
    ]);
    const stored = await database.select().from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.reversalId, refunded.reversals[0]!.id));
    expect(stored).toHaveLength(2);
    expect(stored.every(({ invoicePaymentId }) => invoicePaymentId !== null)).toBe(true);
  });

  it('counts each shift by the money keyed to it, not by the invoices raised in it', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const shifts = createDrizzleCashierSessionRepository(database, createErpAuditCapability());
    const first = await repository.complete(operation(data, crypto.randomUUID()));
    await repository.complete({
      ...operation(data, crypto.randomUUID()),
      invoiceNumber: `INV-2026.08.03-14.40-${data.branchId}`,
    });

    // The till that sold the invoice closes, and the next one opens.
    const closedAt = new Date('2026-08-03T18:00:00.000Z');
    await database.update(cashierSessions)
      .set({ closedAt, closedByAccountId: data.accountId })
      .where(eq(cashierSessions.id, data.cashierSessionId));
    const nextSessionId = Number((await database.insert(cashierSessions).values({
      branchId: data.branchId,
      openedByAccountId: data.accountId,
      openedAt: closedAt,
    }))[0].insertId);

    // The money goes back out of the new till, an hour into the new shift.
    await repository.reverse({
      type: 'refund',
      invoiceId: first.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Approved customer refund',
        lines: [{ invoiceLineId: first.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'visa', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      reversedAt: new Date('2026-08-03T19:00:00.000Z'),
    });

    const sold = (await shifts.findMoneyById(data.cashierSessionId))!;
    expect(sold).toMatchObject({
      saleCount: 2,
      taken: { cash: '370.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
      refunded: { cash: '0.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
      takenTotal: '370.00',
      refundedTotal: '0.00',
      net: '370.00',
    });

    // The refunding shift sold nothing and is out of pocket for the whole refund.
    const refunding = (await shifts.findMoneyById(nextSessionId))!;
    expect(refunding).toMatchObject({
      saleCount: 0,
      refunded: { cash: '0.00', visa: '185.00', instapay: '0.00', vodafone_cash: '0.00' },
      takenTotal: '0.00',
      refundedTotal: '185.00',
      net: '-185.00',
    });

    expect(await shifts.listInvoices(data.cashierSessionId)).toHaveLength(2);
    expect(await shifts.listInvoices(nextSessionId)).toEqual([expect.objectContaining({
      id: first.id,
      status: 'refunded',
      takenInShift: '0.00',
      refundedInShift: '185.00',
    })]);

    const listed = await shifts.list({
      branchId: data.branchId, openedByAccountId: undefined, page: 1, pageSize: 20,
    });
    // Newest first, so the till a Cashier just closed is the one they see.
    expect(listed.total).toBe(2);
    expect(listed.items.map(({ id }) => id)).toEqual([nextSessionId, data.cashierSessionId]);

    const mine = await shifts.list({
      branchId: data.branchId, openedByAccountId: data.adminAccountId, page: 1, pageSize: 20,
    });
    expect(mine).toEqual({ items: [], total: 0 });
  });

  it('attributes every payment row to the shift, the account, and the instant that took it', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const result = await repository.complete(operation(data, crypto.randomUUID()));

    const [payment] = await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, result.id));
    expect(payment).toMatchObject({
      cashierSessionId: data.cashierSessionId,
      actingAccountId: data.accountId,
    });
    // Step 6 will let a second instalment be paid in a later shift, so the money
    // is keyed to when it was handed over, not to when the invoice was raised.
    expect(payment!.paidAt).toEqual(data.at);
  });

  it('audits inactive roster rows before replacing the full branch roster', async () => {
    const data = await fixture();
    await database.update(employees).set({ employmentStatus: 'inactive' })
      .where(eq(employees.id, data.sellerEmployeeId));
    const repository = createDrizzleBranchCashierRosterRepository(
      database,
      createErpAuditCapability(),
    );

    await repository.replace({
      branchId: data.branchId,
      employeeIds: [],
      replacedAt: data.at,
    });

    const event = (await database.select().from(auditEvents).where(and(
      eq(auditEvents.module, 'erp_cashier_roster'),
      eq(auditEvents.entityId, String(data.branchId)),
    )).orderBy(sql`${auditEvents.id} desc`).limit(1))[0];
    expect(event?.beforeState).toEqual({ members: [data.sellerEmployeeId] });
  });

  it('rejects removing the seller from a completed invoice', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    await expect(database.update(invoices).set({
      sellerEmployeeId: null,
      sellerNameSnapshot: null,
    }).where(eq(invoices.id, completed.id))).rejects.toThrow();
  });

  it('rejects a seller who is not on the branch roster', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const outside = operation(data, crypto.randomUUID());
    outside.input = { ...outside.input, sellerEmployeeId: data.employeeId };

    await expect(repository.complete(outside)).rejects.toMatchObject({
      code: 'SELLER_NOT_ON_ROSTER',
    });
  });

  it('projects the changing net commission into one live payroll input', async () => {
    const data = await fixture();
    const payroll = createErpPayrollCapability(database);
    const repository = createDrizzleSaleRepository(
      database,
      createErpAuditCapability(),
      payroll,
    );
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    expect(completed.seller).toMatchObject({
      id: data.sellerEmployeeId,
      name: `Seller ${data.marker}`,
    });
    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, data.employeeId),
    )).toEqual([expect.objectContaining({
      payrollMonth: '2026-08-01', amount: '30.00',
      reference: `erp-commission:2026-08:${data.employeeId}`,
    })]);

    await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Commission reversal before payroll finalization',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      reversedAt: new Date('2026-09-01T09:00:00.000Z'),
    });

    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, data.employeeId),
    )).toEqual([expect.objectContaining({ amount: '0.00' })]);
  });

  it('atomically reassigns a service, moves commission, updates payroll, and replays retries', async () => {
    const data = await fixture();
    const targetEmployeeId = Number((await database.insert(employees).values({
      employeeCode: data.employeeCode + 2,
      fullName: `Target ${data.marker}`,
      personalPhone: `010${String(Number(data.clientPhone.slice(3)) + 1).padStart(8, '0')}`,
      whatsappPhone: `011${String(Number(data.clientPhone.slice(3)) + 1).padStart(8, '0')}`,
      pinHash: 'unused', age: 30, address: 'Cairo', branchId: data.branchId,
      shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00',
      createdAt: data.at, updatedAt: data.at,
    }))[0].insertId);
    const repository = createDrizzleSaleRepository(
      database, createErpAuditCapability(), createErpPayrollCapability(database),
    );
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const command = {
      invoiceId: completed.id,
      invoiceLineId: completed.lines[0]!.id,
      input: {
        branchId: data.branchId,
        employeeId: targetEmployeeId,
        operationReference: crypto.randomUUID(),
        reason: 'Actual performer',
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin' as const,
      reassignedAt: new Date('2026-08-03T12:00:00.000Z'),
      assertEmployee: async () => ({
        id: targetEmployeeId, employeeCode: data.employeeCode + 2,
        fullName: `Target ${data.marker}`, branchId: data.branchId,
      }),
    };

    const [reassigned, replayed] = await Promise.all([
      repository.reassignLine(command), repository.reassignLine(command),
    ]);
    expect(replayed).toEqual(reassigned);

    expect(reassigned.lines[0]).toMatchObject({
      employee: { id: targetEmployeeId, name: `Target ${data.marker}` },
      originalEmployee: { id: data.employeeId, name: `Employee ${data.marker}` },
      reassignments: [expect.objectContaining({
        fromEmployee: expect.objectContaining({ id: data.employeeId }),
        toEmployee: expect.objectContaining({ id: targetEmployeeId }),
        reason: 'Actual performer',
      })],
    });
    expect(await database.select().from(invoiceLineReassignments).where(
      eq(invoiceLineReassignments.invoiceLineId, completed.lines[0]!.id),
    )).toHaveLength(1);
    expect(await database.select().from(commissionLedgerEntries).where(
      eq(commissionLedgerEntries.invoiceLineId, completed.lines[0]!.id),
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: data.employeeId, entryType: 'reassignment_out', amount: '-30.00' }),
      expect.objectContaining({ employeeId: targetEmployeeId, entryType: 'reassignment_in', amount: '30.00' }),
    ]));
    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.payrollMonth, '2026-08-01'),
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: data.employeeId, amount: '0.00' }),
      expect.objectContaining({ employeeId: targetEmployeeId, amount: '30.00' }),
    ]));

    await repository.reverse({
      type: 'refund', invoiceId: completed.id,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(),
        reason: 'Refund after correction',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date('2026-08-03T12:05:00.000Z'),
    });
    expect(await database.select().from(commissionLedgerEntries).where(and(
      eq(commissionLedgerEntries.invoiceLineId, completed.lines[0]!.id),
      eq(commissionLedgerEntries.entryType, 'reversal'),
    ))).toEqual([expect.objectContaining({ employeeId: targetEmployeeId, amount: '-30.00' })]);
    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.payrollMonth, '2026-08-01'),
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: data.employeeId, amount: '0.00' }),
      expect.objectContaining({ employeeId: targetEmployeeId, amount: '0.00' }),
    ]));
    await expect(repository.reassignLine({
      ...command,
      input: {
        ...command.input,
        employeeId: data.employeeId,
        operationReference: crypto.randomUUID(),
        reason: 'Too late after refund',
      },
      assertEmployee: async () => ({
        id: data.employeeId, employeeCode: data.employeeCode,
        fullName: `Employee ${data.marker}`, branchId: data.branchId,
      }),
    })).rejects.toMatchObject({ code: 'INVOICE_NOT_REASSIGNABLE' });
  });

  it('rolls back reassignment when either employee payroll is finalized', async () => {
    const data = await fixture();
    const targetEmployeeId = Number((await database.insert(employees).values({
      employeeCode: data.employeeCode + 2,
      fullName: `Locked target ${data.marker}`,
      personalPhone: `010${String(Number(data.clientPhone.slice(3)) + 2).padStart(8, '0')}`,
      whatsappPhone: `011${String(Number(data.clientPhone.slice(3)) + 2).padStart(8, '0')}`,
      pinHash: 'unused', age: 30, address: 'Cairo', branchId: data.branchId,
      shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00',
      createdAt: data.at, updatedAt: data.at,
    }))[0].insertId);
    const repository = createDrizzleSaleRepository(
      database, createErpAuditCapability(), createErpPayrollCapability(database),
    );
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const finalizedAt = new Date('2026-09-01T08:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId: targetEmployeeId, payrollMonth: '2026-08-01',
      baseSalary: '5000.00', proratedBase: '5000.00', overtimeAmount: '0.00',
      bonusAmount: '0.00', commissionAmount: '0.00', attendanceDeductionAmount: '0.00',
      manualDeductionAmount: '0.00', commissionDeductionAmount: '0.00', advanceAmount: '0.00',
      priorNegativeCarry: '0.00', netSalary: '5000.00', eligibleWorkdays: 31,
      fullMonthWorkdays: 31, requiredMinutes: 14880, overtimeMinutes: 0, shortageMinutes: 0,
      finalizedAt, createdAt: finalizedAt, updatedAt: finalizedAt,
    });

    await expect(repository.reassignLine({
      invoiceId: completed.id, invoiceLineId: completed.lines[0]!.id,
      input: {
        branchId: data.branchId, employeeId: targetEmployeeId,
        operationReference: crypto.randomUUID(), reason: 'Must be blocked',
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reassignedAt: new Date('2026-08-03T12:00:00.000Z'),
      assertEmployee: async () => ({
        id: targetEmployeeId, employeeCode: data.employeeCode + 2,
        fullName: `Locked target ${data.marker}`, branchId: data.branchId,
      }),
    })).rejects.toMatchObject({ code: 'REASSIGN_PAYROLL_FINALIZED' });
    expect(await database.select().from(invoiceLineReassignments).where(
      eq(invoiceLineReassignments.invoiceLineId, completed.lines[0]!.id),
    )).toHaveLength(0);
  });

  it('serializes concurrent reversals before recalculating the employee-month projection', async () => {
    const data = await fixture();
    const realPayroll = createErpPayrollCapability(database);
    const completing = createDrizzleSaleRepository(database, createErpAuditCapability(), realPayroll);
    const first = await completing.complete(operation(data, crypto.randomUUID()));
    const secondOperation = operation(data, crypto.randomUUID());
    secondOperation.invoiceNumber = `${secondOperation.invoiceNumber}-2`;
    const second = await completing.complete(secondOperation);

    let lockArrivals = 0;
    let projectArrivals = 0;
    let releaseLocks!: () => void;
    let releaseProjects!: () => void;
    const lockGate = new Promise<void>((resolve) => { releaseLocks = resolve; });
    const projectGate = new Promise<void>((resolve) => { releaseProjects = resolve; });
    const coordinatedPayroll: ErpPayrollCapability = {
      async lockCommissionEmployee(employeeId, context) {
        lockArrivals += 1;
        if (lockArrivals === 2) releaseLocks();
        await lockGate;
        await realPayroll.lockCommissionEmployee(employeeId, context);
      },
      async projectCommission(input, context) {
        if (lockArrivals === 0) {
          projectArrivals += 1;
          if (projectArrivals === 2) releaseProjects();
          await projectGate;
        }
        return realPayroll.projectCommission(input, context);
      },
      recordPostPayrollDeduction: (input, context) => (
        realPayroll.recordPostPayrollDeduction(input, context)
      ),
    };
    const reversing = createDrizzleSaleRepository(
      database,
      createErpAuditCapability(),
      coordinatedPayroll,
    );
    const reverse = (invoiceId: number) => reversing.reverse({
      type: 'refund', invoiceId,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'Concurrent refund',
        lines: [{ invoiceLineId: invoiceId === first.id ? first.lines[0]!.id : second.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date('2026-09-01T09:00:00.000Z'),
    });

    await Promise.all([reverse(first.id), reverse(second.id)]);

    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, data.employeeId),
    )).toEqual([expect.objectContaining({ amount: '0.00' })]);
  });

  it('turns a commission reversal after payroll finalization into an idempotent deduction', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(
      database,
      createErpAuditCapability(),
      createErpPayrollCapability(database),
    );
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const finalizedAt = new Date('2026-09-01T08:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId: data.employeeId, payrollMonth: '2026-08-01',
      baseSalary: '5000.00', proratedBase: '5000.00', overtimeAmount: '0.00',
      bonusAmount: '0.00', commissionAmount: '30.00', attendanceDeductionAmount: '0.00',
      manualDeductionAmount: '0.00', commissionDeductionAmount: '0.00', advanceAmount: '0.00',
      priorNegativeCarry: '0.00', netSalary: '5030.00', eligibleWorkdays: 31,
      fullMonthWorkdays: 31, requiredMinutes: 14880, overtimeMinutes: 0, shortageMinutes: 0,
      finalizedAt, createdAt: finalizedAt, updatedAt: finalizedAt,
    });
    const command = {
      type: 'refund' as const,
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Commission reversal after payroll finalization',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash' as const, amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin' as const,
      reversedAt: new Date('2026-09-01T09:00:00.000Z'),
    };

    const refunded = await repository.reverse(command);
    await expect(repository.reverse(command)).resolves.toEqual(refunded);

    expect(await database.select().from(erpPostPayrollDeductions).where(
      eq(erpPostPayrollDeductions.employeeId, data.employeeId),
    )).toEqual([expect.objectContaining({
      payrollMonth: '2026-09-01', amount: '30.00',
      reference: expect.stringMatching(/^erp-commission-reversal:\d+:/),
    })]);
  });

  it('does not deduct a legacy commission that was never snapshotted into finalized payroll', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(
      database,
      createErpAuditCapability(),
      createErpPayrollCapability(database),
    );
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const finalizedAt = new Date('2026-09-01T08:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId: data.employeeId, payrollMonth: '2026-08-01',
      baseSalary: '5000.00', proratedBase: '5000.00', overtimeAmount: '0.00',
      bonusAmount: '0.00', commissionAmount: '0.00', attendanceDeductionAmount: '0.00',
      manualDeductionAmount: '0.00', commissionDeductionAmount: '0.00', advanceAmount: '0.00',
      priorNegativeCarry: '0.00', netSalary: '5000.00', eligibleWorkdays: 31,
      fullMonthWorkdays: 31, requiredMinutes: 14880, overtimeMinutes: 0, shortageMinutes: 0,
      finalizedAt, createdAt: finalizedAt, updatedAt: finalizedAt,
    });

    await repository.reverse({
      type: 'refund', invoiceId: completed.id,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'Legacy unpaid commission',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date('2026-09-01T09:00:00.000Z'),
    });

    expect(await database.select().from(erpPostPayrollDeductions).where(
      eq(erpPostPayrollDeductions.employeeId, data.employeeId),
    )).toHaveLength(0);
  });

  it('backfills existing ledger commission only when payroll is still open', async () => {
    const open = await fixture();
    const finalized = await fixture();
    const repository = createDrizzleSaleRepository(
      database,
      createErpAuditCapability(),
      createErpPayrollCapability(database),
    );
    await repository.complete(operation(open, crypto.randomUUID()));
    await repository.complete(operation(finalized, crypto.randomUUID()));
    const finalizedAt = new Date('2026-09-01T08:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId: finalized.employeeId, payrollMonth: '2026-08-01',
      baseSalary: '5000.00', proratedBase: '5000.00', overtimeAmount: '0.00',
      bonusAmount: '0.00', commissionAmount: '0.00', attendanceDeductionAmount: '0.00',
      manualDeductionAmount: '0.00', commissionDeductionAmount: '0.00', advanceAmount: '0.00',
      priorNegativeCarry: '0.00', netSalary: '5000.00', eligibleWorkdays: 31,
      fullMonthWorkdays: 31, requiredMinutes: 14880, overtimeMinutes: 0, shortageMinutes: 0,
      finalizedAt, createdAt: finalizedAt, updatedAt: finalizedAt,
    });
    await database.delete(erpCommissionPayrollInputs);

    await database.execute(sql.raw(erp17Backfill));

    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, open.employeeId),
    )).toEqual([expect.objectContaining({ amount: '30.00', payrollMonth: '2026-08-01' })]);
    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, finalized.employeeId),
    )).toHaveLength(0);
  });

  it('reads employee/month totals with invoice-line and reversal traceability', async () => {
    const data = await fixture();
    const sales = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await sales.complete(operation(data, crypto.randomUUID()));
    await sales.reverse({
      type: 'refund', invoiceId: completed.id,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'Trace me',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date('2026-09-01T09:00:00.000Z'),
    });
    const commissions = createDrizzleCommissionRepository(database);

    await expect(commissions.summary(data.employeeId, '2026-08')).resolves.toMatchObject({
      employeeId: data.employeeId, earnedAmount: '30.00', reversedAmount: '30.00',
      netAmount: '0.00', invoiceLineCount: 1, reversalCount: 1,
    });
    await expect(commissions.detail(data.branchId, data.employeeId, '2026-08'))
      .resolves.toMatchObject({
        entries: [
          expect.objectContaining({ type: 'earned', invoiceId: completed.id, amount: '30.00' }),
          expect.objectContaining({ type: 'reversal', reversalId: expect.any(Number), amount: '-30.00' }),
        ],
      });
    await expect(commissions.list(data.branchId, {
      month: '2026-08', page: 1, pageSize: 20,
    })).resolves.toMatchObject({ items: [expect.objectContaining({ employeeId: data.employeeId })], total: 1 });
  });

});
