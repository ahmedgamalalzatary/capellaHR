import { createDatabase } from '@capella/database';
import {
  accounts,
  auditEvents,
  branches,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  employees,
  erpCategories,
  erpServiceCommissionOverrides,
  erpServices,
  invoiceLines,
  invoicePayments,
  invoices,
} from '@capella/database/schema';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { ErpAssignmentError } from '../../src/modules/erp/assignment/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import type { CompleteSaleOperation } from '../../src/modules/erp/sales/sale-service.js';

const controlDatabase = createDatabase(process.env.DATABASE_URL ?? '');
const isolatedDatabaseName = `capella_hr_test_erp9_${process.pid}_${Date.now()}`;
const isolatedDatabaseUrl = new URL(process.env.DATABASE_URL ?? '');
isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`;
const database = createDatabase(isolatedDatabaseUrl.toString());

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
    clientId, serviceId, cashierSessionId,
  };
};

const operation = (data: Awaited<ReturnType<typeof fixture>>, key: string) => ({
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

  it('maps an invoice-number collision without a matching idempotency key to a conflict', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const first = operation(data, crypto.randomUUID());
    await repository.complete(first);

    await expect(repository.complete(operation(data, crypto.randomUUID())))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
