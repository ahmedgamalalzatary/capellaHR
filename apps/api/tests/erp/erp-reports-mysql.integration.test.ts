import { createDatabase } from '@capella/database';
import {
  accounts,
  branches,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  employees,
  erpCategories,
  erpProducts,
  erpProductStocks,
  erpServiceCommissionOverrides,
  erpServices,
  invoiceReversals,
} from '@capella/database/schema';
import { erpTabReportTypes } from '@capella/contracts';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createErpReportsModule } from '../../src/modules/erp/erp-reports/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import type { CompleteSaleOperation } from '../../src/modules/erp/sales/sale-service.js';
import { createErpPayrollCapability } from '../../src/modules/payroll/index.js';

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (!configuredDatabaseUrl) {
  throw new Error('DATABASE_URL must be set for ERP reports MySQL integration tests');
}
const control = createDatabase(configuredDatabaseUrl);
const databaseName = `capella_hr_test_erp19_${process.pid}_${Date.now()}`;
const databaseUrl = new URL(configuredDatabaseUrl);
databaseUrl.pathname = `/${databaseName}`;
const database = createDatabase(databaseUrl.toString());
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/database/migrations',
);
const soldAt = new Date('2026-08-09T09:00:00.000Z');
const reversedAt = new Date('2026-09-01T09:00:00.000Z');
const employeePinSentinel = 'ERP_REPORT_EMPLOYEE_PIN_SENTINEL';
const cashierPasswordSentinel = 'ERP_REPORT_CASHIER_PASSWORD_SENTINEL';
const adminPasswordSentinel = 'ERP_REPORT_ADMIN_PASSWORD_SENTINEL';

let branchId: number;
let otherBranchId: number;
let invoiceId: number;
let serviceLineId: number;
let productLineId: number;
let employeeId: number;
let adminId: number;
let originalProductName: string;

beforeAll(async () => {
  if (!/^capella_hr_test_erp19_\d+_\d+$/.test(databaseName)) {
    throw new Error('Unsafe ERP 19 integration database name');
  }
  await control.execute(sql.raw(
    `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  ));
  await migrate(database, { migrationsFolder });

  branchId = Number((await database.insert(branches).values({
    name: 'فرع تقارير ERP', nameNormalized: 'erp-reports-branch', location: 'Cairo',
    latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 100,
    createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  otherBranchId = Number((await database.insert(branches).values({
    name: 'فرع آخر', nameNormalized: 'erp-reports-other', location: 'Giza',
    latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 100,
    createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  employeeId = Number((await database.insert(employees).values({
    employeeCode: 1_919_001, fullName: 'موظف التقرير', personalPhone: '01019190001',
    whatsappPhone: '01119190001', pinHash: employeePinSentinel, age: 30, address: 'Cairo',
    branchId, shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00',
    createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  const cashierId = Number((await database.insert(accounts).values({
    username: 'erp19-cashier', passwordHash: cashierPasswordSentinel, role: 'cashier', employeeId,
    createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  adminId = Number((await database.insert(accounts).values({
    username: 'erp19-admin', passwordHash: adminPasswordSentinel, role: 'admin',
    createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  const clientId = Number((await database.insert(clients).values({
    branchId, fullName: 'عميل التقرير', phone: '01219190001',
    createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  const categoryId = Number((await database.insert(erpCategories).values({
    branchId, type: 'service', name: 'خدمات التقرير', nameNormalized: 'erp-report-services',
    createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  const serviceId = Number((await database.insert(erpServices).values({
    branchId, categoryId, name: 'خدمة تاريخية', nameNormalized: 'historical-service',
    price: '200.00', commissionPercent: '10.00', createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  originalProductName = 'منتج تاريخي';
  const productId = Number((await database.insert(erpProducts).values({
    branchId, name: originalProductName, nameNormalized: 'historical-product',
    sellingPrice: '50.00', lastPurchaseCost: '30.00', lowStockThreshold: 1,
    createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  await database.insert(erpProductStocks).values({ productId, branchId, quantity: 2, updatedAt: soldAt });
  await database.insert(erpServiceCommissionOverrides).values({
    serviceId, employeeId, commissionPercent: '15.00', createdAt: soldAt, updatedAt: soldAt,
  });
  const cashierSessionId = Number((await database.insert(cashierSessions).values({
    branchId, openedByAccountId: cashierId, openedAt: soldAt,
  }))[0].insertId);
  const operation: CompleteSaleOperation = {
    input: {
      branchId, clientId, assignedEmployeeId: employeeId, cashierSessionId,
      idempotencyKey: crypto.randomUUID(),
      lines: [
        { itemType: 'service', serviceId, quantity: 1, unitPrice: '200.00' },
        { itemType: 'product', productId, quantity: 1 },
      ],
      discount: { kind: 'percentage', value: '10.00' },
      tax: { kind: 'fixed', value: '5.00' },
      payments: [{ method: 'cash', amount: '230.00' }],
    },
    actingAccountId: cashierId,
    actingAccountRole: 'cashier',
    actingEmployeeId: employeeId,
    invoiceNumber: 'INV.2026.08.09.0001',
    soldAt,
    assertEmployee: async () => ({
      id: employeeId, employeeCode: 1_919_001, fullName: 'موظف التقرير', branchId,
    }),
  };
  const sales = createDrizzleSaleRepository(
    database, createErpAuditCapability(), createErpPayrollCapability(database),
  );
  const completed = await sales.complete(operation);
  invoiceId = completed.id;
  serviceLineId = completed.lines.find((line) => line.itemType === 'service')!.id;
  productLineId = completed.lines.find((line) => line.itemType === 'product')!.id;
  await sales.reverse({
    type: 'refund', invoiceId,
    input: {
      branchId, idempotencyKey: crypto.randomUUID(), reason: 'استرداد منتج التقرير',
      lines: [{ invoiceLineId: productLineId, quantity: 1 }],
      payments: [{ method: 'cash', amount: '46.00' }],
    },
    actingAccountId: adminId, actingAccountRole: 'admin', reversedAt,
  });
  await database.update(erpProducts).set({ name: 'اسم منتج جديد', updatedAt: reversedAt })
    .where(eq(erpProducts.id, productId));
  await database.update(erpServices).set({ name: 'اسم خدمة جديد', updatedAt: reversedAt })
    .where(eq(erpServices.id, serviceId));
}, 120_000);

afterAll(async () => {
  try {
    await database.$client.promise().end();
  } finally {
    try {
      await control.execute(sql.raw(`DROP DATABASE IF EXISTS \`${databaseName}\``));
    } finally {
      await control.$client.promise().end();
    }
  }
}, 30_000);

describe('ERP reports MySQL reader', () => {
  it('reads every ERP report tab through one safe branch/date-filtered capability', async () => {
    const reader = createErpReportsModule(database).reader;
    for (const reportType of erpTabReportTypes) {
      const result = await reader.read(
        reportType,
        { branchId, dateFrom: '2026-08-01', dateTo: '2026-09-30' },
        { mode: 'all' },
        { page: 1, pageSize: 20 },
        reversedAt,
      );
      expect(result).toMatchObject({ kind: 'success' });
      if (result.kind !== 'success') continue;
      expect(result.snapshot.reportType).toBe(reportType);
      expect(result.snapshot.columns.length).toBeGreaterThan(0);
      expect(result.snapshot.summary.totalRecords).toBe(result.total);
      const serializedSnapshot = JSON.stringify(result.snapshot);
      expect(serializedSnapshot).not.toContain('pinHash');
      expect(serializedSnapshot).not.toContain('passwordHash');
      expect(serializedSnapshot).not.toContain(employeePinSentinel);
      expect(serializedSnapshot).not.toContain(cashierPasswordSentinel);
      expect(serializedSnapshot).not.toContain(adminPasswordSentinel);
    }
  });

  it('excludes pending commission reversals from commission rows and totals', async () => {
    const earned = (await database.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.invoiceLineId, serviceLineId)))[0]!;
    const pendingReversalId = Number((await database.insert(invoiceReversals).values({
      invoiceId, branchId, type: 'refund', idempotencyKey: crypto.randomUUID(),
      reason: 'Pending report exclusion', actingAccountId: adminId,
      grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      businessDate: '2026-09-02', createdAt: new Date('2026-09-02T09:00:00.000Z'),
    }))[0].insertId);
    await database.insert(commissionLedgerEntries).values({
      invoiceId, invoiceLineId: serviceLineId, employeeId, actingAccountId: adminId,
      entryType: 'reversal', reversesEntryId: earned.id, invoiceReversalId: pendingReversalId,
      commissionRuleSnapshot: earned.commissionRuleSnapshot,
      commissionRateSnapshot: earned.commissionRateSnapshot,
      baseAmount: '200.00', amount: '-30.00', createdAt: new Date('2026-09-02T09:00:00.000Z'),
    });

    const result = await createErpReportsModule(database).reader.read(
      'erp-commissions', { branchId, dateFrom: '2026-08-01', dateTo: '2026-09-30' },
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt,
    );

    expect(result).toMatchObject({
      kind: 'success', total: 1,
      snapshot: { summary: { totalRecords: 1, totalCommission: '30.00' } },
    });
  });

  it('uses invoice snapshots and exact last-purchase-cost profit for sale and reversal months', async () => {
    const reader = createErpReportsModule(database).reader;
    const august = await reader.read(
      'erp-profit', { branchId, dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt,
    );
    const september = await reader.read(
      'erp-profit', { branchId, dateFrom: '2026-09-01', dateTo: '2026-09-30' },
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt,
    );

    expect(august).toMatchObject({
      kind: 'success', total: 1,
      snapshot: {
        rows: [expect.objectContaining({
          productName: originalProductName, quantity: 1,
          revenue: '45.00', cost: '30.00', profit: '15.00',
        })],
        summary: { totalRevenue: '45.00', totalCost: '30.00', totalProfit: '15.00' },
      },
    });
    expect(september).toMatchObject({
      kind: 'success', total: 1,
      snapshot: {
        rows: [expect.objectContaining({
          productName: originalProductName, quantity: -1,
          revenue: '-45.00', cost: '-30.00', profit: '-15.00',
        })],
        summary: { totalRevenue: '-45.00', totalCost: '-30.00', totalProfit: '-15.00' },
      },
    });
    await expect(reader.read(
      'erp-profit', { branchId: otherBranchId, dateFrom: '2026-08-01', dateTo: '2026-09-30' },
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt,
    )).resolves.toMatchObject({ kind: 'success', total: 0 });

    await expect(reader.read(
      'erp-stock', { branchId, search: originalProductName }, { mode: 'all' },
      { page: 1, pageSize: 20 }, reversedAt,
    )).resolves.toMatchObject({
      kind: 'success',
      snapshot: { rows: expect.arrayContaining([
        expect.objectContaining({ productName: originalProductName }),
      ]) },
    });
  });

  it('builds an Arabic A4 invoice snapshot from the selected branch-owned invoice', async () => {
    const reader = createErpReportsModule(database).reader;
    const result = await reader.read(
      'erp-invoice', { branchId }, { mode: 'selected', ids: [invoiceId] },
      { page: 1, pageSize: 20 }, reversedAt,
    );
    expect(result).toMatchObject({
      kind: 'success', total: 2,
      snapshot: {
        rows: expect.arrayContaining([
          expect.objectContaining({ itemName: 'خدمة تاريخية' }),
          expect.objectContaining({ itemName: originalProductName }),
        ]),
        summary: {
          invoiceNumber: 'INV.2026.08.09.0001', clientName: 'عميل التقرير',
          subtotal: '250.00', discountAmount: '25.00', taxAmount: '5.00', total: '230.00',
        },
      },
    });
    await expect(reader.read(
      'erp-invoice', { branchId: otherBranchId }, { mode: 'selected', ids: [invoiceId] },
      { page: 1, pageSize: 20 }, reversedAt,
    )).resolves.toMatchObject({ kind: 'success', total: 0 });
  });
});
