import {
  accounts,
  erpProductStocks,
  invoiceReversals,
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
});
