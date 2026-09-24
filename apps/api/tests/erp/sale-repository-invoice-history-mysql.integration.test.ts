import {
  accounts,
  cashierSessions,
} from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { closeMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';
import { createSaleRepositoryMysqlFixtures } from './sale-repository-mysql-fixtures.js';

const { database, fixture, operation } = createSaleRepositoryMysqlFixtures();
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

describe('ERP sale repository MySQL integration', () => {
  it('sorts historical and numeric invoice numbers correctly after six digits', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const leading = operation(data, crypto.randomUUID());
    leading.invoiceNumber = '000123';
    const first = operation(data, crypto.randomUUID());
    first.invoiceNumber = '999999';
    const second = operation(data, crypto.randomUUID());
    second.invoiceNumber = '1000000';
    const historical = operation(data, crypto.randomUUID());
    await repository.complete(leading);
    await repository.complete(first);
    await repository.complete(second);
    await repository.complete(historical);

    const result = await repository.listInvoices(data.branchId, {
      page: 1, pageSize: 20, orderBy: 'invoiceNumber', orderDir: 'asc',
    });
    expect(result.items.map((invoice) => invoice.invoiceNumber)).toEqual([
      historical.invoiceNumber, '000123', '999999', '1000000',
    ]);
    const search = await repository.listInvoices(data.branchId, {
      page: 1, pageSize: 20, orderBy: 'soldAt', orderDir: 'desc', search: '000123',
    });
    expect(search.items.map((invoice) => invoice.invoiceNumber)).toEqual(['000123']);
  });

  it('lists and hydrates only stored invoices from the requested branch', async () => {
    const first = await fixture();
    const second = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const stored = await repository.complete(operation(first, crypto.randomUUID()));
    await repository.complete(operation(second, crypto.randomUUID()));

    await expect(repository.listInvoices(first.branchId, { page: 1, pageSize: 20, orderBy: 'soldAt', orderDir: 'desc' }))
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

  it('filters invoice history by status, settlement, dates, and employee with sortable columns', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const base = { page: 1, pageSize: 20, orderBy: 'soldAt', orderDir: 'desc' } as const;

    const settled = await repository.complete(operation(data, crypto.randomUUID()));

    await database.update(cashierSessions).set({
      closedAt: new Date('2026-08-03T12:00:00.000Z'),
      closedByAccountId: data.accountId,
    }).where(eq(cashierSessions.id, data.cashierSessionId));
    const laterSessionId = Number((await database.insert(cashierSessions).values({
      branchId: data.branchId,
      openedByAccountId: data.accountId,
      openedAt: new Date('2026-08-10T09:00:00.000Z'),
    }))[0].insertId);

    const partial = operation(data, crypto.randomUUID());
    partial.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1 }];
    partial.input.discount = undefined;
    partial.input.tax = undefined;
    partial.input.payments = [{ method: 'cash', amount: '20.00' }];
    partial.input.cashierSessionId = laterSessionId;
    partial.invoiceNumber = `INV-2026.08.10-10.00-${data.branchId}`;
    partial.soldAt = new Date('2026-08-10T10:00:00.000Z');
    const open = await repository.complete(partial);

    // A void is only valid on the current Cairo business day, so the voided
    // invoice sells now while the filter fixtures stay on fixed August dates.
    const now = new Date();
    const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(now);
    await database.update(cashierSessions).set({
      closedAt: new Date('2026-08-10T12:00:00.000Z'),
      closedByAccountId: data.accountId,
    }).where(eq(cashierSessions.id, laterSessionId));
    const todaySessionId = Number((await database.insert(cashierSessions).values({
      branchId: data.branchId,
      openedByAccountId: data.accountId,
      openedAt: now,
    }))[0].insertId);
    const pricey = operation(data, crypto.randomUUID());
    pricey.input.lines = [{
      itemType: 'service', serviceId: data.serviceId, quantity: 2, unitPrice: '200.00',
      employeeId: data.sellerEmployeeId,
    }];
    pricey.input.discount = undefined;
    pricey.input.tax = undefined;
    pricey.input.payments = [{ method: 'cash', amount: '400.00' }];
    pricey.assertEmployees = async () => [{
      id: data.sellerEmployeeId,
      employeeCode: data.employeeCode + 1,
      fullName: `Seller ${data.marker}`,
      branchId: data.branchId,
    }];
    pricey.input.cashierSessionId = todaySessionId;
    pricey.invoiceNumber = `INV-${businessDate.replaceAll('-', '.')}-12.00-${data.branchId}`;
    pricey.soldAt = now;
    const completed = await repository.complete(pricey);
    const voided = await repository.reverse({
      type: 'void',
      invoiceId: completed.id,
      input: { branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'Duplicate sale' },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: now,
    });
    expect(voided.status).toBe('voided');

    const ids = (items: Array<{ id: number }>) => items.map((item) => item.id);
    const list = (query: object) => repository.listInvoices(
      data.branchId, { ...base, ...query },
    );

    await expect(list({ status: 'completed' }).then((result) => ids(result.items)))
      .resolves.toEqual(expect.arrayContaining([settled.id, open.id]));
    await expect(list({ status: 'completed' }).then((result) => ids(result.items)))
      .resolves.not.toContain(voided.id);
    await expect(list({ status: 'voided' }).then((result) => ids(result.items)))
      .resolves.toEqual([voided.id]);

    await expect(list({ settlementStatus: 'open' }).then((result) => ids(result.items)))
      .resolves.toContain(open.id);
    await expect(list({ settlementStatus: 'open' }).then((result) => ids(result.items)))
      .resolves.not.toContain(settled.id);
    await expect(list({ settlementStatus: 'settled' }).then((result) => ids(result.items)))
      .resolves.toContain(settled.id);
    await expect(list({ settlementStatus: 'settled' }).then((result) => ids(result.items)))
      .resolves.not.toContain(open.id);

    await expect(list({ fromDate: '2026-08-05' }).then((result) => ids(result.items)))
      .resolves.toEqual(expect.arrayContaining([open.id, voided.id]));
    await expect(list({ fromDate: '2026-08-05' }).then((result) => ids(result.items)))
      .resolves.not.toContain(settled.id);
    await expect(list({ toDate: '2026-08-04' }).then((result) => ids(result.items)))
      .resolves.toEqual([settled.id]);

    await expect(list({ employeeId: data.employeeId }).then((result) => ids(result.items)))
      .resolves.toEqual([settled.id]);

    await expect(list({ orderBy: 'total', orderDir: 'asc' }).then((result) => ids(result.items)))
      .resolves.toEqual([open.id, settled.id, voided.id]);
    await expect(list({ orderBy: 'total', orderDir: 'desc' }).then((result) => ids(result.items)))
      .resolves.toEqual([voided.id, settled.id, open.id]);
    await expect(list({}).then((result) => ids(result.items)))
      .resolves.toEqual([voided.id, open.id, settled.id]);
  });
});
