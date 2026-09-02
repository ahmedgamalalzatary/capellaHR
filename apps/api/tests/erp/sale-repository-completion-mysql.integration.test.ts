import { createDatabase } from '@capella/database';
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
  erpServiceCommissionOverrides,
  erpServices,
  invoiceLines,
  invoicePayments,
  invoices,
} from '@capella/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { ErpAssignmentError } from '../../src/modules/erp/assignment/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { createDrizzleProductStockRepository } from '../../src/modules/erp/stock/index.js';
import type { CompleteSaleOperation } from '../../src/modules/erp/sales/sale-service.js';

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
  it('writes a complete service sale with snapshots, override commission, payment, and audit', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const idempotencyKey = crypto.randomUUID();
    const result = await repository.complete(operation(data, idempotencyKey));

    expect(result).toMatchObject({
      status: 'completed',
      client: { id: data.clientId },
      totals: { subtotal: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00' },
      lines: [{
        sourceId: data.serviceId,
        employee: { id: data.employeeId, employeeCode: data.employeeCode },
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
      actingAccountId: data.accountId,
      cashierSessionId: data.cashierSessionId,
      invoiceNumber: `INV-2026.08.03-14.36-${data.branchId}`,
      idempotencyKey: crypto.randomUUID(),
      clientNameSnapshot: `Client ${data.marker}`,
      clientPhoneSnapshot: data.clientPhone,
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

  it('pays each service line its own employee, at that employee\'s own rate', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    // The first employee holds a 15% override on this service; the second holds
    // none and so earns the service default of 10%.
    request.input.lines = [
      {
        itemType: 'service', serviceId: data.serviceId, quantity: 1, unitPrice: '200.00',
        employeeId: data.employeeId,
      },
      {
        itemType: 'service', serviceId: data.serviceId, quantity: 1, unitPrice: '200.00',
        employeeId: data.sellerEmployeeId,
      },
    ];
    delete request.input.discount;
    delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '400.00' }];
    request.assertEmployees = async () => [
      {
        id: data.employeeId, employeeCode: data.employeeCode,
        fullName: `Employee ${data.marker}`, branchId: data.branchId,
      },
      {
        id: data.sellerEmployeeId, employeeCode: data.employeeCode + 1,
        fullName: `Seller ${data.marker}`, branchId: data.branchId,
      },
    ];

    const completed = await repository.complete(request);

    expect(completed.lines).toMatchObject([
      {
        employee: { id: data.employeeId, name: `Employee ${data.marker}` },
        commissionRule: 'employee_override', commissionRate: '15.00', commissionAmount: '30.00',
      },
      {
        employee: { id: data.sellerEmployeeId, name: `Seller ${data.marker}` },
        commissionRule: 'service_default', commissionRate: '10.00', commissionAmount: '20.00',
      },
    ]);
    const ledger = await database.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.invoiceId, completed.id));
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: data.employeeId, amount: '30.00' }),
      expect.objectContaining({ employeeId: data.sellerEmployeeId, amount: '20.00' }),
    ]));
    await expect(repository.listInvoices(data.branchId, { page: 1, pageSize: 20 }))
      .resolves.toMatchObject({
        items: [{
          id: completed.id,
          employees: [{ id: data.employeeId }, { id: data.sellerEmployeeId }],
        }],
      });

    // Refunding only the second line takes commission back from that employee alone.
    await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'الخدمة الثانية فقط',
        lines: [{ invoiceLineId: completed.lines[1]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '200.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      reversedAt: data.at,
    });

    expect(await database.select().from(commissionLedgerEntries).where(and(
      eq(commissionLedgerEntries.invoiceId, completed.id),
      eq(commissionLedgerEntries.entryType, 'reversal'),
    ))).toEqual([
      expect.objectContaining({ employeeId: data.sellerEmployeeId, amount: '-20.00' }),
    ]);
  });

  it('rejects a submitted price that differs from a fixed service price', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{
      itemType: 'service', serviceId: data.serviceId, quantity: 1, unitPrice: '175.00',
      employeeId: data.employeeId,
    }];

    await expect(repository.complete(request)).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
      .toHaveLength(0);
  });

  it('uses an open service sale price for totals, invoice snapshots, and commission', async () => {
    const data = await fixture();
    await database.update(erpServices).set({ price: null }).where(eq(erpServices.id, data.serviceId));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{
      itemType: 'service', serviceId: data.serviceId, quantity: 2, unitPrice: '800.00',
      employeeId: data.employeeId,
    }];
    delete request.input.discount;
    delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '1600.00' }];

    const completed = await repository.complete(request);

    expect(completed).toMatchObject({
      totals: { subtotal: '1600.00', total: '1600.00' },
      lines: [{ unitPrice: '800.00', lineTotal: '1600.00', commissionAmount: '240.00' }],
    });
  });

  it('rolls back the aggregate when attendance revalidation fails', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.assertEmployees = () => Promise.reject(
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
          employees: [{ id: first.employeeId }],
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

  it('rejects a sale under a shift that has run past its sixteen-hour limit', async () => {
    const data = await fixture();
    await database.update(cashierSessions)
      .set({ openedAt: new Date(data.at.getTime() - 17 * 60 * 60_000) })
      .where(eq(cashierSessions.id, data.cashierSessionId));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());

    await expect(repository.complete(operation(data, crypto.randomUUID())))
      .rejects.toMatchObject({ code: 'CASHIER_SESSION_NOT_OPEN' });
    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
      .toHaveLength(0);
  });

  it('prices product lines at cost and commits the caller\'s work in the same transaction', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const visited: string[] = [];

    // 2 units at the product's 30.00 cost, not its 50.00 shelf price.
    const invoice = await repository.complete({
      ...operation(data, crypto.randomUUID()),
      input: {
        branchId: data.branchId,
        clientId: data.clientId,
        sellerEmployeeId: data.sellerEmployeeId,
        cashierSessionId: data.cashierSessionId,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ itemType: 'product' as const, productId: data.productId, quantity: 2 }],
        payments: [{ method: 'cash' as const, amount: '60.00' }],
      },
      pricing: 'cost',
      afterInvoice: async (transaction, completed) => {
        visited.push(completed.invoiceNumber);
        await transaction.update(erpProducts).set({ lowStockThreshold: 7 })
          .where(eq(erpProducts.id, data.productId));
      },
    });

    expect(invoice.lines[0]).toMatchObject({ unitPrice: '30.00', lineTotal: '60.00' });
    expect(invoice.totals.total).toBe('60.00');
    expect(visited).toEqual([invoice.invoiceNumber]);
    expect((await database.select({ threshold: erpProducts.lowStockThreshold }).from(erpProducts)
      .where(eq(erpProducts.id, data.productId)).limit(1))[0]?.threshold).toBe(7);
  });

  it('rolls the whole sale back when the caller\'s work inside it fails', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());

    await expect(repository.complete({
      ...operation(data, crypto.randomUUID()),
      input: {
        branchId: data.branchId,
        clientId: data.clientId,
        sellerEmployeeId: data.sellerEmployeeId,
        cashierSessionId: data.cashierSessionId,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ itemType: 'product' as const, productId: data.productId, quantity: 2 }],
        payments: [{ method: 'cash' as const, amount: '60.00' }],
      },
      pricing: 'cost',
      afterInvoice: async () => { throw new Error('destination stock refused'); },
    })).rejects.toThrow('destination stock refused');

    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
      .toHaveLength(0);
    expect((await database.select({ quantity: erpProductStocks.quantity }).from(erpProductStocks)
      .where(eq(erpProductStocks.productId, data.productId)).limit(1))[0]?.quantity).toBe(2);
  });

  it('rejects a sale at the exact instant a shift reaches its sixteen-hour limit', async () => {
    const data = await fixture();
    await database.update(cashierSessions)
      .set({ openedAt: new Date(data.at.getTime() - 16 * 60 * 60_000) })
      .where(eq(cashierSessions.id, data.cashierSessionId));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());

    await expect(repository.complete(operation(data, crypto.randomUUID())))
      .rejects.toMatchObject({ code: 'CASHIER_SESSION_NOT_OPEN' });
    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId)))
      .toHaveLength(0);
  });

  it('rejects a sale when the seller left the branch roster before the transaction', async () => {
    const data = await fixture();
    await database.delete(branchCashierRoster).where(and(
      eq(branchCashierRoster.branchId, data.branchId),
      eq(branchCashierRoster.employeeId, data.sellerEmployeeId),
    ));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());

    await expect(repository.complete(operation(data, crypto.randomUUID())))
      .rejects.toMatchObject({ code: 'SELLER_NOT_ON_ROSTER' });
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
      lines: [{
        itemType: 'service', serviceId: data.serviceId, quantity: 1, unitPrice: '200.00',
      }],
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

  it('maps a sellerless legacy idempotency row to a deterministic conflict', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const stored = (await database.select().from(invoices)
      .where(eq(invoices.id, completed.id)).limit(1))[0]!;
    const legacyKey = crypto.randomUUID();
    await database.insert(invoices).values({
      ...stored,
      id: undefined,
      status: 'draft',
      invoiceNumber: `${stored.invoiceNumber}-LEGACY`,
      idempotencyKey: legacyKey,
      sellerEmployeeId: null,
      sellerNameSnapshot: null,
    });
    await expect(repository.findByIdempotencyKey(legacyKey, {
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
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

  it('lets a branch hold one product per barcode and many with none, and finds them by code', async () => {
    const data = await fixture();
    const repository = createDrizzleProductStockRepository(database, createErpAuditCapability(), () => data.at);
    const write = (suffix: string, barcode: string | null) => ({
      branchId: data.branchId, name: `Coded ${suffix} ${data.marker}`,
      nameNormalized: `coded-${suffix}-${data.marker}`, description: null,
      sellingPrice: '10.00', lastPurchaseCost: '0.00', lowStockThreshold: 0,
      barcode, isActive: true, openingQuantity: 0,
    });

    // Thirteen digits, unique to this run, so a rerun cannot clash with itself.
    const code = `2${String(process.pid).slice(-6).padStart(6, '0')}${String(Date.now()).slice(-6)}`;
    const coded = await repository.create(write('a', code), data.adminAccountId);
    expect(await repository.findByBarcode(data.branchId, coded.barcode!))
      .toMatchObject({ id: coded.id });

    // A duplicate code in the same branch is refused by the index itself.
    await expect(repository.create(write('b', coded.barcode), data.adminAccountId)).rejects.toBeDefined();

    // "No barcode yet" is the normal state and must never be a uniqueness clash.
    await repository.create(write('c', null), data.adminAccountId);
    await expect(repository.create(write('d', null), data.adminAccountId)).resolves.toBeDefined();
  });

  it('refuses a code the scanner could never have read', async () => {
    const data = await fixture();
    const repository = createDrizzleProductStockRepository(database, createErpAuditCapability(), () => data.at);
    await expect(repository.create({
      branchId: data.branchId, name: `Bad ${data.marker}`, nameNormalized: `bad-${data.marker}`,
      description: null, sellingPrice: '10.00', lastPurchaseCost: '0.00', lowStockThreshold: 0,
      barcode: 'ab', isActive: true, openingQuantity: 0,
    }, data.adminAccountId)).rejects.toBeDefined();
  });
});
