import {
  accounts,
  branchCashierRoster,
  cashierSessions,
  erpProducts,
  erpProductStocks,
  invoices,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import type { CompleteSaleOperation } from '../../src/modules/erp/sales/sale-service.js';
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
        cashierSessionId: data.cashierSessionId,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ itemType: 'product' as const, productId: data.productId, quantity: 2 }],
        payments: [],
      },
      pricing: 'cost',
      kind: 'branch_transfer',
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
        cashierSessionId: data.cashierSessionId,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ itemType: 'product' as const, productId: data.productId, quantity: 2 }],
        payments: [],
      },
      pricing: 'cost',
      kind: 'branch_transfer',
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

  it('allows a sale without branch cashier roster membership', async () => {
    const data = await fixture();
    await database.delete(branchCashierRoster).where(and(
      eq(branchCashierRoster.branchId, data.branchId),
      eq(branchCashierRoster.employeeId, data.sellerEmployeeId),
    ));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());

    await expect(repository.complete(operation(data, crypto.randomUUID())))
      .resolves.toMatchObject({ status: 'completed', seller: null });
  });

  it('rejects a product when employee validation does not return its assigned employee', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 1, employeeId: data.employeeId }];
    delete request.input.discount;
    delete request.input.tax;
    request.input.payments = [{ method: 'cash', amount: '50.00' }];
    request.assertEmployees = async () => [];
    await expect(repository.complete(request)).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_ASSIGNABLE' });
    expect(await database.select().from(invoices).where(eq(invoices.branchId, data.branchId))).toHaveLength(0);
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
});
