import {
  accounts,
  auditEvents,
  cashierSessions,
  commissionLedgerEntries,
  invoiceReversals,
  serviceConsumptionReports,
  serviceQueueEntries,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { closeMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';
import { createSaleRepositoryMysqlFixtures } from './sale-repository-mysql-fixtures.js';

const cairoBusinessDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((entry) => entry.type === type)!.value
  );
  return `${part('year')}-${part('month')}-${part('day')}`;
};

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
  it('voids a same-day service invoice and appends the exact commission reversal', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const now = new Date();
    const sale = operation(data, crypto.randomUUID());
    sale.soldAt = now;
    sale.invoiceNumber = String(data.branchId).padStart(6, '0');
    // The sale happens now, so its shift must have been opened within the limit.
    await database.update(cashierSessions).set({ openedAt: now })
      .where(eq(cashierSessions.id, data.cashierSessionId));
    const completed = await repository.complete(sale);
    expect(completed.eligibility.canVoid).toBe(true);
    await database.update(serviceQueueEntries).set({
      status: 'completed', completedAt: now, completedByAccountId: data.accountId,
    }).where(eq(serviceQueueEntries.invoiceId, completed.id));

    const voided = await repository.reverse({
      type: 'void',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Duplicate sale',
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: now,
    });

    expect(voided.status).toBe('voided');
    expect(await database.select({
      status: serviceQueueEntries.status,
      completedAt: serviceQueueEntries.completedAt,
      completedByAccountId: serviceQueueEntries.completedByAccountId,
    }).from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.invoiceId, completed.id)))
      .toEqual([expect.objectContaining({
        status: 'canceled', completedAt: null, completedByAccountId: null,
      })]);
    const reversalId = (await database.select({ id: invoiceReversals.id }).from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id)))[0]!.id;
    expect(await database.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.invoiceId, completed.id))).toEqual([
      expect.objectContaining({ entryType: 'earned', baseAmount: '200.00', amount: '30.00' }),
      expect.objectContaining({
        entryType: 'reversal', invoiceReversalId: reversalId,
        baseAmount: '200.00', amount: '-30.00',
      }),
    ]);
    expect(await database.select().from(auditEvents).where(and(
      eq(auditEvents.entityType, 'invoice'),
      eq(auditEvents.entityId, String(completed.id)),
      eq(auditEvents.action, 'void'),
    ))).toEqual([expect.objectContaining({
      relatedIds: expect.objectContaining({ actingAccountId: String(data.accountId) }),
    })]);
  });

  it('keeps a completed service unchanged when its consumption report already exists', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const now = new Date();
    const sale = operation(data, crypto.randomUUID());
    sale.soldAt = now;
    sale.invoiceNumber = `INV-${cairoBusinessDate(now).replaceAll('-', '.')}-14.35-${data.branchId}`;
    await database.update(cashierSessions).set({ openedAt: now })
      .where(eq(cashierSessions.id, data.cashierSessionId));
    const completed = await repository.complete(sale);
    const [queue] = await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.invoiceId, completed.id));
    await database.update(serviceQueueEntries).set({
      status: 'completed', completedAt: now, completedByAccountId: data.accountId,
    }).where(eq(serviceQueueEntries.id, queue!.id));
    await database.insert(serviceConsumptionReports).values({
      serviceQueueEntryId: queue!.id,
      revision: 1,
      isCurrent: true,
      completionKind: 'none',
      actingAccountId: data.accountId,
      createdAt: now,
    });

    await repository.reverse({
      type: 'void',
      invoiceId: completed.id,
      input: { branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'Duplicate sale' },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: now,
    });

    expect(await database.select({
      status: serviceQueueEntries.status,
      completedAt: serviceQueueEntries.completedAt,
      completedByAccountId: serviceQueueEntries.completedByAccountId,
    }).from(serviceQueueEntries).where(eq(serviceQueueEntries.id, queue!.id)))
      .toEqual([expect.objectContaining({
        status: 'completed', completedAt: now, completedByAccountId: data.accountId,
      })]);
  });

  it('rejects a void exactly when the Cairo business date rolls over', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    await expect(repository.reverse({
      type: 'void',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Late cancellation',
      },
      actingAccountId: data.accountId,
      actingAccountRole: 'cashier',
      reversedAt: new Date('2026-08-03T22:30:00.000Z'),
    })).rejects.toMatchObject({ code: 'VOID_DATE_EXPIRED' });
    expect(await database.select().from(invoiceReversals)
      .where(eq(invoiceReversals.invoiceId, completed.id))).toHaveLength(0);
  });
});
