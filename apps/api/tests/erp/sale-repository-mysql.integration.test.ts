import { createDatabase } from '@capella/database';
import {
  accounts,
  auditEvents,
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
  erpStockMovements,
  erpServiceCommissionOverrides,
  erpServices,
  invoiceLines,
  invoicePayments,
  invoiceReversalLines,
  invoiceReversalPayments,
  invoiceReversals,
  invoices,
  payrollMonths,
} from '@capella/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { ErpAssignmentError } from '../../src/modules/erp/assignment/index.js';
import { createDrizzleCommissionRepository } from '../../src/modules/erp/commissions/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { createDrizzleProductStockRepository } from '../../src/modules/erp/stock/index.js';
import { createDrizzleInvoiceSequenceStore } from '../../src/modules/erp/sales/invoice-sequence-store.js';
import type { CompleteSaleOperation } from '../../src/modules/erp/sales/sale-service.js';
import { createErpPayrollCapability, type ErpPayrollCapability } from '../../src/modules/payroll/index.js';

const controlDatabase = createDatabase(process.env.DATABASE_URL ?? '');
const isolatedDatabaseName = `capella_hr_test_erp9_${process.pid}_${Date.now()}`;
const isolatedDatabaseUrl = new URL(process.env.DATABASE_URL ?? '');
isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`;
const database = createDatabase(isolatedDatabaseUrl.toString());
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
  if (!/^capella_hr_test_erp9_\d+_\d+$/.test(isolatedDatabaseName)) {
    throw new Error('Unsafe ERP 9 integration database name');
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
  await database.$client.promise().end();
  await controlDatabase.execute(sql.raw(`DROP DATABASE IF EXISTS \`${isolatedDatabaseName}\``));
  await controlDatabase.$client.promise().end();
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
  const accountId = Number((await database.insert(accounts).values({
    username: marker,
    passwordHash: 'unused',
    role: 'cashier',
    employeeId,
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
    marker, clientPhone, at, branchId, employeeId, employeeCode, accountId, adminAccountId,
    clientId, serviceId, productId, cashierSessionId,
  };
};

const operation = (data: Awaited<ReturnType<typeof fixture>>, key: string): CompleteSaleOperation => ({
  input: {
    branchId: data.branchId,
    clientId: data.clientId,
    assignedEmployeeId: data.employeeId,
    cashierSessionId: data.cashierSessionId,
    idempotencyKey: key,
    lines: [{ itemType: 'service' as const, serviceId: data.serviceId, quantity: 1 }],
    discount: { kind: 'percentage' as const, value: '10.00' },
    tax: { kind: 'fixed' as const, value: '5.00' },
    payments: [{ method: 'cash' as const, amount: '185.00' }],
  },
  actingAccountId: data.accountId,
  actingAccountRole: 'cashier' as const,
  actingEmployeeId: data.employeeId,
  invoiceNumber: `INV-2026.08.03-14.35-${data.branchId}`,
  soldAt: data.at,
  assertEmployee: async () => ({
    id: data.employeeId,
    employeeCode: data.employeeCode,
    fullName: `Employee ${data.marker}`,
    branchId: data.branchId,
  }),
});

describe('ERP sale repository MySQL integration', () => {
  it('projects the changing net commission into one live payroll input', async () => {
    const data = await fixture();
    const payroll = createErpPayrollCapability(database);
    const repository = createDrizzleSaleRepository(
      database,
      createErpAuditCapability(),
      payroll,
    );
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

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
    await expect(reverse(1, '51.00'))
      .rejects.toMatchObject({ code: 'REFUND_PAYMENT_EXCEEDED' });
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
      reversalId: pendingId, invoicePaymentId: payment.id, methodSnapshot: 'cash', amount: '50.00',
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
      invoicePaymentId: payment.id,
      methodSnapshot: payment.method,
      amount: '185.00',
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
      reversalId: pendingId, invoicePaymentId: payment.id, methodSnapshot: 'cash', amount: '1.00',
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
      reversalId: pendingId, invoicePaymentId: payment.id, methodSnapshot: 'cash', amount: '50.00',
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
        reversalId, invoicePaymentId: payment.id, methodSnapshot: 'cash', amount: '185.00',
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
      lowStockThreshold: 2, isActive: true, openingQuantity: 0,
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

  it('decrements product stock, snapshots cost, records movement, and earns no commission', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    delete request.input.discount;
    delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '100.00' }];
    const result = await repository.complete(request);

    expect(result.lines[0]).toMatchObject({ sourceId: data.productId, productCostBasis: '30.00', commissionRule: 'none', commissionAmount: '0.00' });
    expect((await database.select().from(erpProductStocks).where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(0);
    expect(await database.select().from(erpStockMovements).where(eq(erpStockMovements.sourceId, result.id))).toEqual([
      expect.objectContaining({ productId: data.productId, reason: 'sale', quantityDelta: -2, balanceAfter: 0 }),
    ]);
    expect(await database.select().from(commissionLedgerEntries).where(eq(commissionLedgerEntries.invoiceId, result.id))).toHaveLength(0);
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

  it('writes a complete service sale with snapshots, override commission, payment, and audit', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const idempotencyKey = crypto.randomUUID();
    const result = await repository.complete(operation(data, idempotencyKey));

    expect(result).toMatchObject({
      status: 'completed',
      client: { id: data.clientId },
      assignedEmployee: { id: data.employeeId },
      totals: { subtotal: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00' },
      lines: [{
        sourceId: data.serviceId,
        commissionRule: 'employee_override',
        commissionRate: '15.00',
        commissionAmount: '30.00',
      }],
      payments: [{ method: 'cash', amount: '185.00' }],
    });
    expect(await database.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, result.id)))
      .toHaveLength(1);
    expect(await database.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, result.id)))
      .toHaveLength(1);
    expect(await database.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.invoiceId, result.id))).toHaveLength(1);
    expect(await database.select().from(auditEvents).where(eq(auditEvents.module, 'erp-sales')))
      .toEqual(expect.arrayContaining([expect.objectContaining({ action: 'complete' })]));

    await database.insert(invoices).values({
      branchId: data.branchId,
      clientId: data.clientId,
      assignedEmployeeId: data.employeeId,
      actingAccountId: data.accountId,
      cashierSessionId: data.cashierSessionId,
      invoiceNumber: `INV-2026.08.03-14.36-${data.branchId}`,
      idempotencyKey: crypto.randomUUID(),
      clientNameSnapshot: `Client ${data.marker}`,
      clientPhoneSnapshot: data.clientPhone,
      employeeNameSnapshot: `Employee ${data.marker}`,
      employeeCodeSnapshot: data.employeeCode,
      authorizedBySnapshot: data.marker,
      subtotal: '1.00',
      total: '1.00',
      soldAt: data.at,
      createdAt: data.at,
    });
    const visits = await repository.listClientVisits(data.branchId, data.clientId, {
      page: 1,
      pageSize: 20,
    });
    expect(visits).toMatchObject({ total: 1, items: [{ id: result.id }] });

    const anotherCashier = await fixture();
    await expect(repository.findByIdempotencyKey(idempotencyKey, {
      actingAccountId: anotherCashier.accountId,
      actingAccountRole: 'cashier',
    })).resolves.toBeNull();
  });

  it('rolls back the aggregate when attendance revalidation fails', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.assertEmployee = () => Promise.reject(
      new ErpAssignmentError('ERP_EMPLOYEE_NOT_PRESENT', 'not present'),
    );
    await expect(repository.complete(request)).rejects.toBeInstanceOf(ErpAssignmentError);
    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
      .toHaveLength(0);
  });

  it('lists and hydrates only stored invoices from the requested branch', async () => {
    const first = await fixture();
    const second = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const stored = await repository.complete(operation(first, crypto.randomUUID()));
    await repository.complete(operation(second, crypto.randomUUID()));

    await expect(repository.listInvoices(first.branchId, { page: 1, pageSize: 20 }))
      .resolves.toMatchObject({
        total: 1,
        items: [{
          id: stored.id,
          client: { id: first.clientId },
          assignedEmployee: { id: first.employeeId },
        }],
      });
    await expect(repository.findInvoiceById(first.branchId, stored.id)).resolves.toEqual(stored);
    await expect(repository.findInvoiceById(second.branchId, stored.id)).resolves.toBeNull();
  });

  it('rejects a sale when the acting Cashier account was disabled before the transaction', async () => {
    const data = await fixture();
    await database.update(accounts).set({ active: false }).where(eq(accounts.id, data.accountId));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());

    await expect(repository.complete(operation(data, crypto.randomUUID())))
      .rejects.toMatchObject({ code: 'CASHIER_SESSION_NOT_OPEN' });
    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
      .toHaveLength(0);
  });

  it('rejects a sale when the acting Cashier moved to another branch before the transaction', async () => {
    const data = await fixture();
    const anotherBranch = await fixture();
    await database.update(employees).set({ branchId: anotherBranch.branchId })
      .where(eq(employees.id, data.employeeId));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());

    await expect(repository.complete(operation(data, crypto.randomUUID())))
      .rejects.toMatchObject({ code: 'CASHIER_SESSION_NOT_OPEN' });
    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
      .toHaveLength(0);
  });

  it('allows an Admin to sell through the selected branch open Cashier session', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = {
      ...operation(data, crypto.randomUUID()),
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      actingEmployeeId: null,
    } as CompleteSaleOperation;

    await expect(repository.complete(request)).resolves.toMatchObject({
      status: 'completed',
      authorizedBy: { accountId: data.adminAccountId },
    });
  });

  it('returns a validation failure when a fixed discount exceeds the authoritative subtotal', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    await expect(repository.quote(data.branchId, {
      lines: [{ itemType: 'service', serviceId: data.serviceId, quantity: 1 }],
      discount: { kind: 'fixed', value: '200.01' },
    })).rejects.toMatchObject({ code: 'SALE_VALIDATION_FAILED' });
  });

  it('settles concurrent identical idempotent writes as one stored invoice', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    const results = await Promise.all([
      repository.complete(request),
      repository.complete({ ...request, invoiceNumber: `${request.invoiceNumber}-unused` }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(await database.select().from(invoices)
      .where(eq(invoices.idempotencyKey, request.input.idempotencyKey))).toHaveLength(1);
  });

  it('completes a concurrent counter burst without losing or duplicating service sales', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const requests = Array.from({ length: 10 }, (_, index) => ({
      ...operation(data, crypto.randomUUID()),
      invoiceNumber: `INV-2026.08.03-14.40-${data.branchId * 100 + index + 1}`,
    }));
    const results = await Promise.all(requests.map((request) => repository.complete(request)));
    expect(new Set(results.map(({ id }) => id)).size).toBe(10);
    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
      .toHaveLength(10);
  });

  it('maps an invoice-number collision without a matching idempotency key to a conflict', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const first = operation(data, crypto.randomUUID());
    await repository.complete(first);

    await expect(repository.complete(operation(data, crypto.randomUUID())))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it.each([
    ['invoice', 'BEFORE INSERT', 'erp_invoices'],
    ['line', 'BEFORE INSERT', 'erp_invoice_lines'],
    ['commission', 'BEFORE INSERT', 'erp_commission_ledger_entries'],
    ['payment', 'BEFORE INSERT', 'erp_invoice_payments'],
    ['completion', 'BEFORE UPDATE', 'erp_invoices'],
    ['audit', 'BEFORE INSERT', 'audit_events'],
  ] as const)('rolls back the complete aggregate when %s persistence fails', async (
    phase,
    timing,
    table,
  ) => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const trigger = `erp12_fail_${phase}`;
    await database.execute(sql.raw(
      `CREATE TRIGGER \`${trigger}\` ${timing} ON \`${table}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced ERP 12 rollback'`,
    ));
    try {
      await expect(repository.complete(operation(data, crypto.randomUUID()))).rejects.toBeDefined();
      expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
        .toHaveLength(0);
    } finally {
      await database.execute(sql.raw(`DROP TRIGGER IF EXISTS \`${trigger}\``));
    }
  });

  it('rolls back product stock when stock-movement persistence fails', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1 }];
    delete request.input.discount; delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '50.00' }];
    await database.execute(sql.raw("CREATE TRIGGER `erp13_fail_movement` BEFORE INSERT ON `erp_stock_movements` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced ERP 13 rollback'"));
    try {
      await expect(repository.complete(request)).rejects.toBeDefined();
      expect((await database.select().from(erpProductStocks).where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(2);
      expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId))).toHaveLength(0);
    } finally {
      await database.execute(sql.raw('DROP TRIGGER IF EXISTS `erp13_fail_movement`'));
    }
  });
});
