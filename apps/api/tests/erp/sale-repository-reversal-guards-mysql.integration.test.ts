import {
  accounts,
  erpProductStocks,
  erpStockMovements,
  invoicePayments,
  invoiceReversalLines,
  invoiceReversalPayments,
  invoiceReversals,
  invoices,
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

  it('rejects a direct void whose Cairo business date differs from the sale date', async () => {
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
