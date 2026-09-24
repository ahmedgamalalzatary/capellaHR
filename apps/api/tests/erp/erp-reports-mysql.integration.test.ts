import {
  accounts,
  branchCashierRoster,
  branches,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  employees,
  erpCategories,
  erpProducts,
  erpProductStocks,
  erpStockTransferLines,
  erpStockTransfers,
  erpServiceCommissionOverrides,
  erpServices,
  invoiceLines,
  invoices,
  invoiceReversals,
  serviceQueueEntries,
} from '@capella/database/schema';
import { erpTabReportTypes } from '@capella/contracts';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createErpReportsModule } from '../../src/modules/erp/erp-reports/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import type { CompleteSaleOperation } from '../../src/modules/erp/sales/sale-service.js';
import { createErpPayrollCapability } from '../../src/modules/payroll/index.js';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();
const soldAt = new Date('2026-08-09T09:00:00.000Z');
const reversedAt = new Date('2026-09-01T09:00:00.000Z');
const employeePinSentinel = 'ERP_REPORT_EMPLOYEE_PIN_SENTINEL';
const cashierPasswordSentinel = 'ERP_REPORT_CASHIER_PASSWORD_SENTINEL';
const adminPasswordSentinel = 'ERP_REPORT_ADMIN_PASSWORD_SENTINEL';

let branchId: number;
let otherBranchId: number;
let invoiceId: number;
let productOnlyInvoiceId: number;
let transferInvoiceId: number;
let productId: number;
let serviceLineId: number;
let productLineId: number;
let employeeId: number;
let adminId: number;
let originalProductName: string;

beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);

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
  productId = Number((await database.insert(erpProducts).values({
    branchId, name: originalProductName, nameNormalized: 'historical-product',
    sellingPrice: '50.00', lastPurchaseCost: '30.00', lowStockThreshold: 1,
    createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  await database.insert(erpProductStocks).values({ productId, branchId, quantity: 2, updatedAt: soldAt });
  await database.insert(erpServiceCommissionOverrides).values({
    serviceId, employeeId, commissionPercent: '15.00', createdAt: soldAt, updatedAt: soldAt,
  });
  await database.insert(branchCashierRoster).values({
    branchId, employeeId, createdAt: soldAt,
  });
  const cashierSessionId = Number((await database.insert(cashierSessions).values({
    branchId, openedByAccountId: cashierId, openedAt: soldAt,
  }))[0].insertId);
  const operation: CompleteSaleOperation = {
    input: {
      branchId, clientId, sellerEmployeeId: employeeId,
      cashierSessionId,
      idempotencyKey: crypto.randomUUID(),
      lines: [
        { itemType: 'service', serviceId, quantity: 1, unitPrice: '200.00', employeeId },
        { itemType: 'product', productId, quantity: 1 },
      ],
      discount: { kind: 'percentage', value: '10.00' },
      tax: { kind: 'fixed', value: '5.00' },
      payments: [{ method: 'cash', amount: '230.00' }],
    },
    actingAccountId: cashierId,
    actingAccountRole: 'cashier',
    invoiceNumber: 'INV.2026.08.09.0001',
    soldAt,
    assertEmployees: async () => [{
      id: employeeId, employeeCode: 1_919_001, fullName: 'موظف التقرير', branchId,
    }],
  };
  const sales = createDrizzleSaleRepository(
    database, createErpAuditCapability(), createErpPayrollCapability(database),
  );
  const completed = await sales.complete(operation);
  invoiceId = completed.id;
  serviceLineId = completed.lines.find((line) => line.itemType === 'service')!.id;
  productLineId = completed.lines.find((line) => line.itemType === 'product')!.id;
  const productOnly = await sales.complete({
    input: {
      branchId,
      clientId,
      sellerEmployeeId: employeeId,
      cashierSessionId,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'product', productId, quantity: 1 }],
      payments: [{ method: 'cash', amount: '50.00' }],
    },
    actingAccountId: cashierId,
    actingAccountRole: 'cashier',
    invoiceNumber: 'INV.2026.07.09.0001',
    soldAt: new Date('2026-07-09T09:00:00.000Z'),
  });
  productOnlyInvoiceId = productOnly.id;
  // Internal trade between branches: a real invoice, priced at cost, no seller.
  await database.update(erpProductStocks).set({ quantity: 5, updatedAt: soldAt })
    .where(eq(erpProductStocks.productId, productId));
  transferInvoiceId = (await sales.complete({
    input: {
      branchId,
      clientId,
      cashierSessionId,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ itemType: 'product', productId, quantity: 1 }],
      // At the product's 30.00 cost, without pretending internal trade is cash.
      payments: [],
    },
    actingAccountId: adminId,
    actingAccountRole: 'admin',
    invoiceNumber: 'INV.2026.07.10.0001',
    soldAt: new Date('2026-07-10T09:00:00.000Z'),
    pricing: 'cost',
    kind: 'branch_transfer',
  })).id;
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

afterAll(async () => { await closeMysqlIntegrationDatabase(database); }, 30_000);

describe('ERP reports MySQL reader', () => {
  it('reports individual transfer lines and filtered combined totals', async () => {
    const destinationProductId = Number((await database.insert(erpProducts).values({
      branchId: otherBranchId, name: originalProductName, nameNormalized: 'transfer-destination-product',
      sellingPrice: '35.00', lastPurchaseCost: '25.00', lowStockThreshold: 1,
      createdAt: soldAt, updatedAt: soldAt,
    }))[0].insertId);
    const transferId = Number((await database.insert(erpStockTransfers).values({
      sourceBranchId: branchId, destinationBranchId: otherBranchId, invoiceId: transferInvoiceId,
      idempotencyKey: crypto.randomUUID(), status: 'posting', transferDate: '2026-07-10',
      totalCost: '60.00', actingAccountId: adminId, note: 'نقل مخزون التقرير', createdAt: soldAt,
    }))[0].insertId);
    await database.insert(erpStockTransferLines).values({
      transferId, sourceBranchId: branchId, destinationBranchId: otherBranchId,
      sourceProductId: productId, destinationProductId, productNameSnapshot: originalProductName,
      quantity: 2, unitCost: '30.00', previousDestinationCost: '25.00', lineTotal: '60.00',
    });
    await database.update(erpStockTransfers).set({ status: 'posted' })
      .where(eq(erpStockTransfers.id, transferId));

    const result = await createErpReportsModule(database).reader.read(
      'erp-transfers', {
        sourceBranchId: branchId, destinationBranchId: otherBranchId,
        dateFrom: '2026-07-01', dateTo: '2026-07-31',
      },
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt,
    );
    expect(result).toMatchObject({
      kind: 'success', total: 1,
      snapshot: {
        rows: [expect.objectContaining({
          productName: originalProductName, quantity: 2, unitCost: '30.00', totalCost: '60.00',
          authorizedBy: 'erp19-admin', note: 'نقل مخزون التقرير',
        })],
        summary: { totalRecords: 1, totalQuantity: '2', totalTransferCost: '60.00' },
      },
    });
  });

  it('reports each issued queue number with its stored invoice and service snapshots', async () => {
    const line = (await database.select().from(invoiceLines)
      .where(eq(invoiceLines.id, serviceLineId)))[0]!;
    const session = (await database.select().from(cashierSessions)
      .where(eq(cashierSessions.branchId, branchId)).limit(1))[0]!;
    const extraQueueId = Number((await database.insert(serviceQueueEntries).values({
      invoiceId,
      invoiceLineId: serviceLineId,
      branchId,
      cashierSessionId: session.id,
      serviceId: line.serviceId!,
      employeeId: line.employeeId!,
      queueNumber: 7,
      createdAt: soldAt,
    }))[0].insertId);

    const result = await createErpReportsModule(database).reader.read(
      'erp-service-queue', { branchId, search: '7' }, { mode: 'all' },
      { page: 1, pageSize: 20 }, reversedAt,
    );
    expect(result).toMatchObject({
      kind: 'success', total: 1,
      snapshot: {
        rows: [expect.objectContaining({
          queueNumber: 7,
          shiftId: session.id,
          invoiceNumber: 'INV.2026.08.09.0001',
          serviceName: 'خدمة تاريخية',
        })],
        summary: { totalRecords: 1 },
      },
    });
    await database.delete(serviceQueueEntries).where(eq(serviceQueueEntries.id, extraQueueId));
  });

  it('keeps combined service rows after the individual rows for the same item', async () => {
    const firstPage = await createErpReportsModule(database).reader.read(
      'erp-services', { branchId, dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      { mode: 'all' }, { page: 1, pageSize: 1 }, reversedAt,
    );
    const secondPage = await createErpReportsModule(database).reader.read(
      'erp-services', { branchId, dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      { mode: 'all' }, { page: 2, pageSize: 1 }, reversedAt,
    );

    expect(firstPage).toMatchObject({
      kind: 'success',
      snapshot: { rows: [expect.objectContaining({ id: 'sale-1' })] },
    });
    expect(secondPage).toMatchObject({
      kind: 'success',
      snapshot: { rows: [expect.objectContaining({ id: 'combined:خدمة تاريخية' })] },
    });
  });

  it.each([
    ['erp-services', 'serviceName', 'خدمة تاريخية', '2026-08-01', '2026-08-31', '1', '180.00', '184.00'],
    ['erp-products', 'productName', 'منتج تاريخي', '2026-07-01', '2026-07-31', '1', '50.00', '50.00'],
  ] as const)('reports individual and filtered combined rows for %s', async (reportType, nameKey, name, dateFrom, dateTo, quantity, amount, invoicePaid) => {
    const result = await createErpReportsModule(database).reader.read(
      reportType, { branchId, dateFrom, dateTo, search: name },
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt,
    );

    expect(result).toMatchObject({ kind: 'success', total: 2 });
    if (result.kind === 'success') {
      expect(result.snapshot.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ [nameKey]: name, eventType: 'بيع', quantity: '1', amount }),
        expect.objectContaining({
          [nameKey]: name,
          id: `combined:${name}`,
          employeeName: 'موظف التقرير',
          quantity,
          amount,
          invoicePaid,
        }),
      ]));
      expect(result.snapshot.summary).toMatchObject({ totalRevenue: amount });
    }
  });

  it('searches product sales and reversals by the stored seller snapshot', async () => {
    const reader = createErpReportsModule(database).reader;
    const sellerSearch = 'موظف التقرير';
    const sale = await reader.read(
      'erp-products', { branchId, dateFrom: '2026-08-01', dateTo: '2026-08-31', search: sellerSearch },
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt,
    );
    const reversal = await reader.read(
      'erp-products', { branchId, dateFrom: '2026-09-01', dateTo: '2026-09-30', search: sellerSearch },
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt,
    );

    expect(sale).toMatchObject({ kind: 'success', total: 2 });
    expect(reversal).toMatchObject({ kind: 'success', total: 2 });
  });

  it('credits products to the cashier and services to their assigned employee', async () => {
    const reader = createErpReportsModule(database).reader;
    const filters = { branchId, dateFrom: '2026-07-01', dateTo: '2026-09-30' };

    const sales = await reader.read(
      'erp-sales', filters, { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt,
    );
    const employees = await reader.read(
      'erp-employees', filters, { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt,
    );

    // Two customer sales plus the branch transfer, which is a sale too.
    expect(sales).toMatchObject({ kind: 'success', total: 3 });
    // The same person performed the service and acted as cashier, so their
    // service and product activity is combined into one employee row.
    expect(employees).toMatchObject({ kind: 'success', total: 1 });
    if (employees.kind === 'success') {
      expect(employees.snapshot.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: employeeId,
          invoiceCount: 2,
          serviceQuantity: '1',
          serviceAmount: '184.00',
          productQuantity: '1',
          productAmount: '50.00',
          netAmount: '234.00',
        }),
      ]));
      expect(employees.snapshot.summary).toMatchObject({
        totalRecords: 1,
        totalServices: '1',
        totalServiceSales: '184.00',
        totalProducts: '1',
        totalProductSales: '50.00',
        totalNetSales: '234.00',
      });
    }
    expect(productOnlyInvoiceId).toBeGreaterThan(0);
  });

  it('limits ERP rows and their totals to the selected report row identifiers', async () => {
    const result = await createErpReportsModule(database).reader.read(
      'erp-sales', { branchId, dateFrom: '2026-07-01', dateTo: '2026-09-30' },
      { mode: 'selected', ids: [invoiceId] }, { page: 1, pageSize: 20 }, reversedAt,
    );

    expect(result).toMatchObject({
      kind: 'success', total: 1,
      snapshot: {
        rows: [expect.objectContaining({ id: invoiceId, invoiceNumber: 'INV.2026.08.09.0001' })],
        summary: { totalRecords: 1 },
      },
    });
  });

  it('keeps internal trade out of the money reports it would distort', async () => {
    const reader = createErpReportsModule(database).reader;
    const filters = { branchId, dateFrom: '2026-07-01', dateTo: '2026-09-30' };
    const read = async (reportType: 'erp-sales' | 'erp-payment-methods' | 'erp-products' | 'erp-client-history') => {
      const result = await reader.read(
        reportType, filters, { mode: 'all' }, { page: 1, pageSize: 50 }, reversedAt,
      );
      if (result.kind !== 'success') throw new Error(`report ${reportType} unavailable`);
      return result.snapshot.rows;
    };
    const transferNumber = 'INV.2026.07.10.0001';
    const carries = (rows: Array<Record<string, unknown>>) => rows.some((row) => (
      row.invoiceNumber === transferNumber
    ));

    // The sales report shows it, labelled, because it is a sale.
    const salesRows = await read('erp-sales');
    expect(carries(salesRows)).toBe(true);
    expect(salesRows.find((row) => row.invoiceNumber === transferNumber))
      .toMatchObject({ saleKind: 'تحويل بين الفروع' });
    expect(salesRows.find((row) => row.invoiceNumber === 'INV.2026.08.09.0001'))
      .toMatchObject({ saleKind: 'بيع' });

    // The rest would be wrong: no cash entered the drawer, no unit was sold to
    // a customer, and the receiving branch is not a client.
    expect(carries(await read('erp-payment-methods'))).toBe(false);
    expect(carries(await read('erp-products'))).toBe(false);
    expect(carries(await read('erp-client-history'))).toBe(false);
  });

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
      if (reportType === 'erp-services' || reportType === 'erp-products') {
        expect(result.total).toBeGreaterThanOrEqual(Number(result.snapshot.summary.totalRecords));
      } else {
        expect(result.snapshot.summary.totalRecords).toBe(result.total);
      }
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
      snapshot: {
        rows: [expect.objectContaining({
          id: employeeId, serviceCount: 1, earnedAmount: '30.00',
          reversedAmount: '0.00', netAmount: '30.00',
        })],
        summary: { totalRecords: 1, totalServices: '1', totalCommission: '30.00' },
      },
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
      'erp-stock', { branchId, search: 'اسم منتج جديد' }, { mode: 'all' },
      { page: 1, pageSize: 20 }, reversedAt,
    )).resolves.toMatchObject({
      kind: 'success',
      snapshot: { rows: expect.arrayContaining([
        expect.objectContaining({
          productName: 'اسم منتج جديد', availableQuantity: expect.any(Number),
          unitCost: '30.00', inventoryValue: expect.any(String),
        }),
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

  // Deliberately last: it refunds a line the earlier tests read as unreversed. The
  // product-only sale is used because products earn no commission, so the refund
  // stays clear of the payroll state an earlier test deliberately left pending.
  it('reports money handed back on a method the sale never used', async () => {
    const sales = createDrizzleSaleRepository(
      database, createErpAuditCapability(), createErpPayrollCapability(database),
    );
    const [productOnlyLine] = await database.select().from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, productOnlyInvoiceId));
    const handedBackAt = new Date('2026-09-02T09:00:00.000Z');
    await sales.reverse({
      type: 'refund', invoiceId: productOnlyInvoiceId,
      input: {
        branchId, idempotencyKey: crypto.randomUUID(), reason: 'رد على الفيزا',
        lines: [{ invoiceLineId: productOnlyLine!.id, quantity: 1 }],
        payments: [{ method: 'visa', amount: '50.00' }],
      },
      actingAccountId: adminId, actingAccountRole: 'admin', reversedAt: handedBackAt,
    });

    const result = await createErpReportsModule(database).reader.read(
      'erp-payment-methods',
      { branchId, dateFrom: '2026-09-02', dateTo: '2026-09-02' },
      { mode: 'all' }, { page: 1, pageSize: 20 }, handedBackAt,
    );

    // The till really paid out 50.00 on the card, so the report must show it even
    // though no card payment was ever taken on this invoice.
    expect(result).toMatchObject({
      kind: 'success',
      total: 1,
      snapshot: {
        rows: [expect.objectContaining({
          invoiceNumber: 'INV.2026.07.09.0001', paymentMethod: 'فيزا', amount: '-50.00',
        })],
        summary: expect.objectContaining({
          totalNetVisaPayments: '-50.00',
        }),
      },
    });
  });

  it('reports each reassigned service ticket under its current employee', async () => {
    const reassignedEmployeeId = Number((await database.insert(employees).values({
      employeeCode: 1_919_002, fullName: 'Reassigned report worker',
      personalPhone: '01019190002', whatsappPhone: '01119190002',
      pinHash: employeePinSentinel, age: 30, address: 'Cairo', branchId,
      shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00',
      createdAt: soldAt, updatedAt: soldAt,
    }))[0].insertId);
    const originalLine = (await database.select().from(invoiceLines)
      .where(eq(invoiceLines.id, serviceLineId)))[0]!;
    const originalInvoice = (await database.select().from(invoices)
      .where(eq(invoices.id, invoiceId)))[0]!;
    const session = (await database.select().from(cashierSessions)
      .where(eq(cashierSessions.branchId, branchId)).limit(1))[0]!;
    const sales = createDrizzleSaleRepository(database, createErpAuditCapability());
    const invoiceNumber = 'INV.2026.08.10.QUEUE-REPORT';
    const invoice = await sales.complete({
      input: {
        branchId, clientId: originalInvoice.clientId, sellerEmployeeId: employeeId,
        cashierSessionId: session.id,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ itemType: 'service', serviceId: originalLine.serviceId!,
          quantity: 3, unitPrice: '200.00', employeeId }],
        payments: [{ method: 'cash', amount: '600.00' }],
      },
      actingAccountId: adminId, actingAccountRole: 'admin', invoiceNumber, soldAt,
      assertEmployees: async () => [{ id: employeeId, employeeCode: 1_919_001,
        fullName: 'موظف التقرير', branchId }],
    });
    const tickets = await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.invoiceId, invoice.id))
      .orderBy(asc(serviceQueueEntries.queueNumber));
    await sales.reassignQueue({
      invoiceId: invoice.id, serviceQueueEntryId: tickets[1]!.id,
      input: { branchId, employeeId: reassignedEmployeeId,
        reason: 'Correct performer', operationReference: crypto.randomUUID() },
      actingAccountId: adminId, actingAccountRole: 'admin', reassignedAt: soldAt,
      assertEmployee: async () => ({ id: reassignedEmployeeId,
        employeeCode: 1_919_002, fullName: 'Reassigned report worker', branchId }),
    });
    await sales.reassignQueue({
      invoiceId: invoice.id, serviceQueueEntryId: tickets[2]!.id,
      input: { branchId, employeeId: reassignedEmployeeId,
        reason: 'Correct performer', operationReference: crypto.randomUUID() },
      actingAccountId: adminId, actingAccountRole: 'admin', reassignedAt: soldAt,
      assertEmployee: async () => ({ id: reassignedEmployeeId,
        employeeCode: 1_919_002, fullName: 'Reassigned report worker', branchId }),
    });
    const reader = createErpReportsModule(database).reader;
    const filters = { branchId, search: invoiceNumber };
    const employeeReport = await reader.read('erp-employees', filters,
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt);
    expect(employeeReport).toMatchObject({ kind: 'success', total: 2,
      snapshot: { rows: expect.arrayContaining([
        expect.objectContaining({ id: employeeId, serviceQuantity: '1', serviceAmount: '200.00' }),
        expect.objectContaining({ id: reassignedEmployeeId,
          serviceQuantity: '2', serviceAmount: '400.00' }),
      ]) } });
    const services = await reader.read('erp-services', filters,
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt);
    expect(services).toMatchObject({ kind: 'success',
      snapshot: { rows: expect.arrayContaining([
        expect.objectContaining({ employeeName: 'موظف التقرير', quantity: '1', amount: '200.00' }),
        expect.objectContaining({ employeeName: 'Reassigned report worker', quantity: '1', amount: '200.00' }),
      ]) } });
    if (services.kind === 'success') {
      expect(services.snapshot.rows.filter((row) => String(row.id).startsWith('sale-'))).toHaveLength(3);
    }
    const commissionReport = await reader.read('erp-commissions', filters,
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt);
    expect(commissionReport).toMatchObject({ kind: 'success', total: 2,
      snapshot: { rows: expect.arrayContaining([
        expect.objectContaining({ id: employeeId, serviceCount: 1,
          earnedAmount: '90.00', reversedAmount: '60.00', netAmount: '30.00' }),
        expect.objectContaining({ id: reassignedEmployeeId, serviceCount: 2,
          earnedAmount: '60.00', reversedAmount: '0.00', netAmount: '60.00' }),
      ]) } });
    await sales.reverse({
      type: 'refund', invoiceId: invoice.id,
      input: { branchId, idempotencyKey: crypto.randomUUID(),
        reason: 'One ticket refunded',
        lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '200.00' }] },
      actingAccountId: adminId, actingAccountRole: 'admin', reversedAt,
    });
    const afterRefund = await reader.read('erp-employees', filters,
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt);
    expect(afterRefund).toMatchObject({ kind: 'success',
      snapshot: { rows: expect.arrayContaining([
        expect.objectContaining({ id: employeeId, serviceQuantity: '1', serviceAmount: '200.00' }),
        expect.objectContaining({ id: reassignedEmployeeId,
          serviceQuantity: '1', serviceAmount: '200.00' }),
      ]) } });
    const refunds = await reader.read('erp-refunds', filters,
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt);
    expect(refunds).toMatchObject({ kind: 'success', total: 1,
      snapshot: { rows: [expect.objectContaining({
        employeeName: 'Reassigned report worker', quantity: 1, amount: '200.00',
      })] } });
    const servicesAfterRefund = await reader.read('erp-services', filters,
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt);
    expect(servicesAfterRefund).toMatchObject({ kind: 'success',
      snapshot: { rows: expect.arrayContaining([
        expect.objectContaining({ employeeName: 'Reassigned report worker',
          eventType: 'استرداد', quantity: '-1', amount: '-200.00' }),
      ]) } });
    if (servicesAfterRefund.kind === 'success') {
      const [invoiceRow] = await database.select().from(invoices).where(eq(invoices.id, invoice.id));
      const paid = Number(invoiceRow!.amountPaid);
      const unitShare = (rank: number) => (
        Number((paid * rank / 3).toFixed(2)) - Number((paid * (rank - 1) / 3).toFixed(2))
      );
      const refundPaid = servicesAfterRefund.snapshot.rows
        .filter((row) => row.eventType === 'استرداد' && !String(row.id).startsWith('combined:'))
        .map((row) => Number(row.invoicePaid));
      expect(refundPaid).toHaveLength(1);
      expect([1, 2, 3].map((rank) => -unitShare(rank))).toContain(refundPaid[0]);
      const combined = servicesAfterRefund.snapshot.rows
        .find((row) => String(row.id).startsWith('combined:'));
      expect(Number(combined!.invoicePaid)).toBeCloseTo(paid + refundPaid[0]!, 2);
    }
  });

  it('counts each invoice paid amount once across product lines', async () => {
    const originalInvoice = (await database.select().from(invoices)
      .where(eq(invoices.id, invoiceId)))[0]!;
    const session = (await database.select().from(cashierSessions)
      .where(eq(cashierSessions.branchId, branchId)).limit(1))[0]!;
    const firstPaidProductId = Number((await database.insert(erpProducts).values({
      branchId, name: 'منتج أول للمدفوع', nameNormalized: 'first-paid-product',
      sellingPrice: '50.00', lastPurchaseCost: '20.00', lowStockThreshold: 1,
      createdAt: soldAt, updatedAt: soldAt,
    }))[0].insertId);
    const secondPaidProductId = Number((await database.insert(erpProducts).values({
      branchId, name: 'منتج ثانٍ للمدفوع', nameNormalized: 'second-paid-product',
      sellingPrice: '50.00', lastPurchaseCost: '20.00', lowStockThreshold: 1,
      createdAt: soldAt, updatedAt: soldAt,
    }))[0].insertId);
    await database.insert(erpProductStocks).values([
      { productId: firstPaidProductId, branchId, quantity: 2, updatedAt: soldAt },
      { productId: secondPaidProductId, branchId, quantity: 2, updatedAt: soldAt },
    ]);
    const sales = createDrizzleSaleRepository(database, createErpAuditCapability());
    const invoiceNumber = 'INV.2026.08.11.TWO-PRODUCTS';
    await sales.complete({
      input: {
        branchId, clientId: originalInvoice.clientId, sellerEmployeeId: employeeId,
        cashierSessionId: session.id, idempotencyKey: crypto.randomUUID(),
        lines: [
          { itemType: 'product', productId: firstPaidProductId, quantity: 1 },
          { itemType: 'product', productId: secondPaidProductId, quantity: 1 },
        ],
        payments: [{ method: 'cash', amount: '100.00' }],
      },
      actingAccountId: adminId, actingAccountRole: 'admin', invoiceNumber, soldAt,
    });
    const result = await createErpReportsModule(database).reader.read(
      'erp-products', { branchId, search: invoiceNumber },
      { mode: 'all' }, { page: 1, pageSize: 20 }, reversedAt,
    );
    expect(result).toMatchObject({ kind: 'success' });
    if (result.kind === 'success') {
      const paidByName = Object.fromEntries(result.snapshot.rows
        .filter((row) => !String(row.id).startsWith('combined:'))
        .map((row) => [String(row.productName), Number(row.invoicePaid)]));
      expect(paidByName).toEqual({
        'منتج أول للمدفوع': 50,
        'منتج ثانٍ للمدفوع': 50,
      });
    }
  });
});
