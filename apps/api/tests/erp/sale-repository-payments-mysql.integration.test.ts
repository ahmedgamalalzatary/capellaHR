import {
  accounts,
  cashierSessions,
  invoicePayments,
  invoiceReversalPayments,
} from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleCashierSessionRepository } from '../../src/modules/erp/sales/cashier-sessions-repository.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import type { ReverseInvoiceOperation } from '../../src/modules/erp/sales/sale-service.js';
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
  it('allocates consecutive queue numbers per service and resets them with the cashier shift', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const firstSale = operation(data, crypto.randomUUID());
    firstSale.input.lines[0] = { ...firstSale.input.lines[0]!, quantity: 3 };
    firstSale.input.payments = [{ method: 'cash', amount: '545.00' }];
    const first = await repository.complete(firstSale);
    expect(first.lines[0]?.queueNumbers).toEqual([1, 2, 3]);

    const secondSale = operation(data, crypto.randomUUID());
    secondSale.invoiceNumber = `${firstSale.invoiceNumber}-2`;
    secondSale.input.lines[0] = { ...secondSale.input.lines[0]!, quantity: 2 };
    secondSale.input.payments = [{ method: 'cash', amount: '365.00' }];
    const second = await repository.complete(secondSale);
    expect(second.lines[0]?.queueNumbers).toEqual([4, 5]);

    await database.update(cashierSessions).set({
      closedAt: data.at,
      closedByAccountId: data.accountId,
    }).where(eq(cashierSessions.id, data.cashierSessionId));
    const nextSessionId = Number((await database.insert(cashierSessions).values({
      branchId: data.branchId,
      openedByAccountId: data.accountId,
      openedAt: data.at,
    }))[0].insertId);
    const nextShiftSale = operation(data, crypto.randomUUID());
    nextShiftSale.invoiceNumber = `${firstSale.invoiceNumber}-3`;
    nextShiftSale.input.cashierSessionId = nextSessionId;
    const nextShift = await repository.complete(nextShiftSale);
    expect(nextShift.lines[0]?.queueNumbers).toEqual([1]);
  });

  it('records one concurrent idempotent instalment on a product-only invoice', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '30.00' }];
    const open = await repository.complete(sale);
    expect(open.totals).toMatchObject({ amountPaid: '30.00', balanceDue: '70.00', settlementStatus: 'open' });

    const payment = {
      invoiceId: open.id,
      input: {
        branchId: data.branchId, cashierSessionId: data.cashierSessionId,
        method: 'cash' as const, amount: '20.00', operationReference: crypto.randomUUID(),
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier' as const,
      paidAt: new Date(data.at.getTime() + 60_000),
    };
    const [first, retry] = await Promise.all([
      repository.recordPayment(payment), repository.recordPayment(payment),
    ]);
    expect(first.totals).toMatchObject({ amountPaid: '50.00', balanceDue: '50.00', settlementStatus: 'open' });
    expect(retry.totals).toEqual(first.totals);
    const shiftReport = await createDrizzleCashierSessionRepository(
      database, createErpAuditCapability(),
    ).readReportAccounting({
      sessionId: data.cashierSessionId,
      branchId: data.branchId,
      openedAt: data.at,
      closedAt: new Date(data.at.getTime() + 120_000),
    });
    expect(shiftReport.collectedPaymentLines).toEqual([{
      invoiceNumber: open.invoiceNumber,
      client: { id: data.clientId, name: `Client ${data.marker}`, phone: data.clientPhone },
      method: 'cash', amount: '20.00', paidAt: payment.paidAt,
    }]);
    expect(await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, open.id))).toHaveLength(2);
    await expect(repository.findByIdempotencyKey(sale.input.idempotencyKey, {
      actingAccountId: data.accountId, actingAccountRole: 'cashier',
    })).resolves.toMatchObject({ input: { payments: [{ method: 'cash', amount: '30.00' }] } });
    await expect(repository.recordPayment({
      ...payment, input: { ...payment.input, amount: '69.00' },
    })).rejects.toEqual(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    await expect(repository.recordPayment({
      ...payment, input: { ...payment.input, amount: '51.00', operationReference: crypto.randomUUID() },
    })).rejects.toEqual(expect.objectContaining({ code: 'PAYMENT_EXCEEDS_BALANCE' }));
    const settled = await repository.recordPayment({
      ...payment, input: { ...payment.input, amount: '50.00', operationReference: crypto.randomUUID() },
    });
    expect(settled.totals).toMatchObject({ amountPaid: '100.00', balanceDue: '0.00', settlementStatus: 'settled' });
    expect(await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, open.id))).toHaveLength(3);
  });

  it('credits product returns against debt before paying cash back', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '30.00' }];
    const open = await repository.complete(sale);
    const line = open.lines[0]!;
    const firstRefund = {
      type: 'refund', invoiceId: open.id,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'First return',
        lines: [{ invoiceLineId: line.id, quantity: 1 }], payments: [],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date(data.at.getTime() + 60_000),
    } satisfies ReverseInvoiceOperation;
    const first = await repository.reverse(firstRefund);
    expect(first.totals).toMatchObject({
      amountPaid: '30.00', creditedAmount: '50.00', balanceDue: '20.00', settlementStatus: 'open',
    });
    await expect(repository.reverse(firstRefund)).resolves.toEqual(first);
    const second = await repository.reverse({
      type: 'refund', invoiceId: open.id,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'Second return',
        lines: [{ invoiceLineId: line.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '30.00' }],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date(data.at.getTime() + 120_000),
    });
    expect(second.totals).toMatchObject({
      amountPaid: '0.00', creditedAmount: '100.00', balanceDue: '0.00', settlementStatus: 'settled',
    });
  });

  it('preserves each original payment link when one refund spans repeated methods', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines = [{ itemType: 'product', productId: data.productId, quantity: 2 }];
    sale.input.discount = undefined;
    sale.input.tax = undefined;
    sale.input.payments = [{ method: 'cash', amount: '30.00' }];
    const open = await repository.complete(sale);
    const paid = await repository.recordPayment({
      invoiceId: open.id,
      input: {
        branchId: data.branchId,
        cashierSessionId: data.cashierSessionId,
        method: 'cash',
        amount: '70.00',
        operationReference: crypto.randomUUID(),
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      paidAt: new Date(data.at.getTime() + 60_000),
    });

    const refunded = await repository.reverse({
      type: 'refund',
      invoiceId: paid.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Return spanning two cash instalments',
        lines: [{ invoiceLineId: paid.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '50.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      reversedAt: new Date(data.at.getTime() + 120_000),
    });

    expect(refunded.payments).toEqual([
      { method: 'cash', amount: '30.00', refundedAmount: '30.00', refundableAmount: '0.00' },
      { method: 'cash', amount: '70.00', refundedAmount: '20.00', refundableAmount: '50.00' },
    ]);
    const stored = await database.select().from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.reversalId, refunded.reversals[0]!.id));
    expect(stored).toHaveLength(2);
    expect(stored.every(({ invoicePaymentId }) => invoicePaymentId !== null)).toBe(true);
  });

  it('counts each shift by the money keyed to it, not by the invoices raised in it', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const shifts = createDrizzleCashierSessionRepository(database, createErpAuditCapability());
    const first = await repository.complete(operation(data, crypto.randomUUID()));
    await repository.complete({
      ...operation(data, crypto.randomUUID()),
      invoiceNumber: `INV-2026.08.03-14.40-${data.branchId}`,
    });

    // The till that sold the invoice closes, and the next one opens.
    const closedAt = new Date('2026-08-03T18:00:00.000Z');
    await database.update(cashierSessions)
      .set({ closedAt, closedByAccountId: data.accountId })
      .where(eq(cashierSessions.id, data.cashierSessionId));
    const nextSessionId = Number((await database.insert(cashierSessions).values({
      branchId: data.branchId,
      openedByAccountId: data.accountId,
      openedAt: closedAt,
    }))[0].insertId);

    // The money goes back out of the new till, an hour into the new shift.
    await repository.reverse({
      type: 'refund',
      invoiceId: first.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Approved customer refund',
        lines: [{ invoiceLineId: first.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'visa', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      reversedAt: new Date('2026-08-03T19:00:00.000Z'),
    });

    const sold = (await shifts.findMoneyById(data.cashierSessionId))!;
    expect(sold).toMatchObject({
      saleCount: 2,
      taken: { cash: '370.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
      refunded: { cash: '0.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
      takenTotal: '370.00',
      refundedTotal: '0.00',
      expenses: '0.00',
      net: '370.00',
    });

    // The refunding shift sold nothing and is out of pocket for the whole refund.
    const refunding = (await shifts.findMoneyById(nextSessionId))!;
    expect(refunding).toMatchObject({
      saleCount: 0,
      refunded: { cash: '0.00', visa: '185.00', instapay: '0.00', vodafone_cash: '0.00' },
      takenTotal: '0.00',
      refundedTotal: '185.00',
      expenses: '0.00',
      net: '-185.00',
    });

    expect(await shifts.listInvoices(data.cashierSessionId)).toHaveLength(2);
    expect(await shifts.listInvoices(nextSessionId)).toEqual([expect.objectContaining({
      id: first.id,
      status: 'refunded',
      takenInShift: '0.00',
      refundedInShift: '185.00',
    })]);

    const listed = await shifts.list({
      branchId: data.branchId, openedByAccountId: undefined, page: 1, pageSize: 20,
    });
    // Newest first, so the till a Cashier just closed is the one they see.
    expect(listed.total).toBe(2);
    expect(listed.items.map(({ id }) => id)).toEqual([nextSessionId, data.cashierSessionId]);

    const mine = await shifts.list({
      branchId: data.branchId, openedByAccountId: data.adminAccountId, page: 1, pageSize: 20,
    });
    expect(mine).toEqual({ items: [], total: 0 });
  });

  it('attributes every payment row to the shift, the account, and the instant that took it', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const result = await repository.complete(operation(data, crypto.randomUUID()));

    const [payment] = await database.select().from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, result.id));
    expect(payment).toMatchObject({
      cashierSessionId: data.cashierSessionId,
      actingAccountId: data.accountId,
    });
    // Step 6 will let a second instalment be paid in a later shift, so the money
    // is keyed to when it was handed over, not to when the invoice was raised.
    expect(payment!.paidAt).toEqual(data.at);
  });
});
