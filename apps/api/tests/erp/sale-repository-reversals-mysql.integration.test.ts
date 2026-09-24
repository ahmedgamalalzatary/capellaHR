import {
  accounts,
  erpProductStocks,
  erpStockMovements,
  invoicePayments,
  invoiceReversalLines,
  invoiceReversalPayments,
  invoiceReversals,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
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

  it('attributes a refund to the shift that handed the money back, or to none', async () => {
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const refundOwnInvoice = async (reversedAt: Date) => {
      const data = await fixture();
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
        actingAccountRole: 'admin' as const,
        reversedAt,
      });
      const [stored] = await database.select().from(invoiceReversals)
        .where(eq(invoiceReversals.id, refunded.reversals[0]!.id));
      return { data, stored: stored! };
    };

    // Handed back while the till that sold it is still open: the same shift.
    const inside = await refundOwnInvoice(new Date('2026-08-03T11:36:00.000Z'));
    expect(inside.stored.cashierSessionId).toBe(inside.data.cashierSessionId);

    // A day later that shift has run past its sixteen hours and no till is open,
    // so the refund belongs to no shift rather than to a stale one.
    const outside = await refundOwnInvoice(new Date('2026-08-05T09:00:00.000Z'));
    expect(outside.stored.cashierSessionId).toBeNull();
  });

  it('hands the money back on a method the sale never used', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    const refunded = await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Client asked for the money on the card',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'visa', amount: '185.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    expect(refunded.reversals[0]!.payments).toEqual([{ method: 'visa', amount: '185.00' }]);
    // Nothing came off the cash the client actually paid, so that row stands untouched.
    expect(refunded.payments).toEqual([{
      method: 'cash', amount: '185.00',
      refundedAmount: '0.00', refundableAmount: '185.00',
    }]);
    const stored = await database.select().from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.reversalId, refunded.reversals[0]!.id));
    expect(stored).toEqual([expect.objectContaining({
      invoicePaymentId: null, methodSnapshot: 'visa', amount: '185.00',
    })]);
  });

  it('still links a refund to the payment it reverses when the method matches', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const [cashPayment] = await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, completed.id));

    const refunded = await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Cash back over the counter',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    expect(await database.select().from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.reversalId, refunded.reversals[0]!.id)))
      .toEqual([expect.objectContaining({ invoicePaymentId: cashPayment!.id })]);
    expect(refunded.payments[0]).toMatchObject({
      refundedAmount: '185.00', refundableAmount: '0.00',
    });
  });

  it('leaves a same-method refund unlinked when it no longer fits the original payment', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [
      { method: 'cash', amount: '30.00' },
      { method: 'visa', amount: '70.00' },
    ];
    const completed = await repository.complete(sale);

    const refunded = await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'All of it back in cash',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '50.00' }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    // The first 30 is linked; only the excess 20 stands on its own.
    expect(await database.select().from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.reversalId, refunded.reversals[0]!.id)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ invoicePaymentId: expect.any(Number), amount: '30.00' }),
        expect.objectContaining({ invoicePaymentId: null, amount: '20.00' }),
      ]));
    expect(refunded.payments).toEqual([
      { method: 'cash', amount: '30.00', refundedAmount: '30.00', refundableAmount: '0.00' },
      { method: 'visa', amount: '70.00', refundedAmount: '0.00', refundableAmount: '70.00' },
    ]);
  });

  it('still refuses a refund payment linked to the wrong payment row', async () => {
    // The link is optional now, but a link that IS given must still be honest.
    // These are the two checks the rewritten insert guard has to keep making.
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    // A second fixture, because one fixture mints a single invoice number.
    const otherData = await fixture();
    const other = await repository.complete(operation(otherData, crypto.randomUUID()));
    const [otherPayment] = await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, other.id));
    const [ownPayment] = await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, completed.id));
    const pendingId = Number((await database.insert(invoiceReversals).values({
      invoiceId: completed.id, branchId: data.branchId, type: 'refund',
      idempotencyKey: crypto.randomUUID(), reason: 'Wrong payment link',
      actingAccountId: data.accountId, approvingAccountId: null,
      grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      businessDate: '2026-08-04', createdAt: new Date('2026-08-04T09:00:00.000Z'),
    }))[0].insertId);

    // Drizzle wraps the trigger's SIGNAL, so the guard is read off the cause.
    const guardMessage = async (invoicePaymentId: number, methodSnapshot: 'cash' | 'visa') => {
      try {
        await database.insert(invoiceReversalPayments).values({
          reversalId: pendingId, invoiceId: completed.id, invoicePaymentId, methodSnapshot,
          amount: '185.00', cashAmount: '185.00',
        });
        return 'accepted';
      } catch (error) {
        return String((error as { cause?: { message?: string } }).cause?.message ?? error);
      }
    };

    // A payment belonging to another invoice, then a link whose method disagrees
    // with the snapshot it is stored under.
    expect(await guardMessage(otherPayment!.id, 'cash'))
      .toMatch(/Invoice reversal payment ownership is invalid/);
    expect(await guardMessage(ownPayment!.id, 'visa'))
      .toMatch(/Invoice reversal payment ownership is invalid/);

    // The honest link is still accepted.
    await database.insert(invoiceReversalPayments).values({
      reversalId: pendingId, invoiceId: completed.id, invoicePaymentId: ownPayment!.id,
      methodSnapshot: 'cash', amount: '185.00', cashAmount: '185.00',
    });
    expect(await database.select().from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.reversalId, pendingId))).toHaveLength(1);
  });

  it('keeps counting an unlinked refund against the invoice, not against a payment', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [
      { method: 'cash', amount: '30.00' },
      { method: 'visa', amount: '70.00' },
    ];
    const completed = await repository.complete(sale);
    const refund = (key: string, method: 'cash' | 'visa', amount: string) => repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId, idempotencyKey: key, reason: 'Sequential return',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method, amount }],
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier' as const,
      reversedAt: new Date('2026-08-04T09:00:00.000Z'),
    });

    await refund(crypto.randomUUID(), 'cash', '50.00');
    const after = await refund(crypto.randomUUID(), 'visa', '50.00');

    // Both units are back, so nothing more can be refunded, even though the cash
    // Linked allocations reduce each original payment independently.
    expect(after.status).toBe('refunded');
    expect(after.eligibility.canRefund).toBe(false);
    expect(after.lines[0]).toMatchObject({ refundedQuantity: 2, refundableQuantity: 0 });
    expect(after.payments).toEqual([
      { method: 'cash', amount: '30.00', refundedAmount: '30.00', refundableAmount: '0.00' },
      { method: 'visa', amount: '70.00', refundedAmount: '50.00', refundableAmount: '20.00' },
    ]);
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
});
