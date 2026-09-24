import {
  accounts,
  cashierSessions,
  commissionLedgerEntries,
  erpServiceCommissionOverrides,
  serviceConsumptionReports,
  serviceQueueEntries,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleCommissionRepository } from '../../src/modules/erp/commissions/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { createErpPayrollCapability } from '../../src/modules/payroll/index.js';
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
  it('lets a cashier reassign an unfinished ticket after its selling shift closes', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const invoice = await repository.complete(operation(data, crypto.randomUUID()));
    const [ticket] = await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.invoiceId, invoice.id));
    const later = new Date(data.at.getTime() + 60 * 60 * 1000);
    await database.update(cashierSessions).set({ closedAt: later,
      closedByAccountId: data.accountId }).where(eq(cashierSessions.id, data.cashierSessionId));
    await database.insert(cashierSessions).values({ branchId: data.branchId,
      openedByAccountId: data.accountId, openedAt: later });
    await repository.reassignQueue({
      invoiceId: invoice.id, serviceQueueEntryId: ticket!.id,
      input: { branchId: data.branchId, employeeId: data.sellerEmployeeId,
        reason: 'Correct performer', operationReference: crypto.randomUUID() },
      actingAccountId: data.accountId, actingAccountRole: 'cashier',
      reassignedAt: new Date(later.getTime() + 1000),
      assertEmployee: async () => ({ id: data.sellerEmployeeId,
        employeeCode: data.employeeCode + 1, fullName: `Seller ${data.marker}`,
        branchId: data.branchId }),
    });
    const [changed] = await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.id, ticket!.id));
    expect(changed!.employeeId).toBe(data.sellerEmployeeId);
  });

  it('allows a service ticket with zero commission to change employee', async () => {
    const data = await fixture();
    await database.update(erpServiceCommissionOverrides)
      .set({ commissionPercent: '0.00' })
      .where(eq(erpServiceCommissionOverrides.serviceId, data.serviceId));
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const invoice = await repository.complete(operation(data, crypto.randomUUID()));
    const [ticket] = await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.invoiceId, invoice.id));
    await repository.reassignQueue({
      invoiceId: invoice.id, serviceQueueEntryId: ticket!.id,
      input: { branchId: data.branchId, employeeId: data.sellerEmployeeId,
        reason: 'Correct performer', operationReference: crypto.randomUUID() },
      actingAccountId: data.accountId, actingAccountRole: 'cashier', reassignedAt: data.at,
      assertEmployee: async () => ({ id: data.sellerEmployeeId,
        employeeCode: data.employeeCode + 1, fullName: `Seller ${data.marker}`,
        branchId: data.branchId }),
    });
    const [changed] = await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.id, ticket!.id));
    expect(changed!.employeeId).toBe(data.sellerEmployeeId);
  });

  it('moves the commission of one queue ticket without changing four siblings', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{
      itemType: 'service', serviceId: data.serviceId, quantity: 5,
      unitPrice: '200.00', employeeId: data.employeeId,
    }];
    request.input.discount = undefined;
    request.input.tax = undefined;
    request.input.payments = [{ method: 'cash', amount: '1000.00' }];
    const invoice = await repository.complete(request);
    const tickets = await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.invoiceId, invoice.id));

    const change = {
      invoiceId: invoice.id,
      serviceQueueEntryId: tickets[1]!.id,
      input: {
        branchId: data.branchId, employeeId: data.sellerEmployeeId,
        reason: 'Correct performer', operationReference: crypto.randomUUID(),
      },
      actingAccountId: data.accountId, actingAccountRole: 'cashier' as const,
      reassignedAt: data.at,
      assertEmployee: async () => ({
        id: data.sellerEmployeeId, employeeCode: data.employeeCode + 1,
        fullName: `Seller ${data.marker}`, branchId: data.branchId,
      }),
    };
    const [changed, replayed] = await Promise.all([
      repository.reassignQueue(change), repository.reassignQueue(change),
    ]);
    expect(replayed).toEqual(changed);
    await expect(repository.reassignQueue({ ...change, invoiceId: invoice.id + 1 }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(repository.reassignQueue({ ...change,
      input: { ...change.input, reason: 'Different correction' },
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const after = await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.invoiceId, invoice.id));
    expect(after.map((ticket) => ticket.employeeId)).toEqual([
      data.employeeId, data.sellerEmployeeId, data.employeeId,
      data.employeeId, data.employeeId,
    ]);
    const ledger = await database.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.invoiceId, invoice.id));
    const total = (employeeId: number) => ledger.filter((entry) => entry.employeeId === employeeId)
      .reduce((sum, entry) => sum + Math.round(Number(entry.amount) * 100), 0);
    expect(total(data.employeeId)).toBe(12000);
    expect(total(data.sellerEmployeeId)).toBe(3000);

    await database.update(serviceQueueEntries).set({
      status: 'completed', completedAt: data.at, completedByAccountId: data.accountId,
    }).where(eq(serviceQueueEntries.id, tickets[2]!.id));
    const completedChange = {
      ...change, serviceQueueEntryId: tickets[2]!.id,
      input: { ...change.input, operationReference: crypto.randomUUID() },
    };
    await expect(repository.reassignQueue(completedChange))
      .rejects.toMatchObject({ code: 'REASSIGN_ADMIN_REQUIRED' });
    await repository.reassignQueue({
      ...completedChange, actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
    });
    const completedTicket = (await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.id, tickets[2]!.id)))[0]!;
    expect(completedTicket.employeeId).toBe(data.sellerEmployeeId);
    expect(completedTicket.status).toBe('completed');
    const history = await repository.listInvoices(data.branchId, {
      page: 1, pageSize: 20, orderBy: 'soldAt', orderDir: 'desc',
      employeeId: data.sellerEmployeeId,
    });
    expect(history.items.map((item) => item.id)).toContain(invoice.id);
    expect(history.items.find((item) => item.id === invoice.id)?.employees.map((item) => item.id))
      .toEqual([data.employeeId, data.sellerEmployeeId]);
    const commissions = createDrizzleCommissionRepository(database, { audit: createErpAuditCapability() });
    expect((await commissions.summary(data.employeeId, '2026-08'))?.serviceUnitCount).toBe(3);
    expect((await commissions.summary(data.sellerEmployeeId, '2026-08'))?.serviceUnitCount).toBe(2);
  });

  it('refunds the commission of the selected queue ticket after reassignment', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{ itemType: 'service', serviceId: data.serviceId, quantity: 2,
      unitPrice: '200.00', employeeId: data.employeeId }];
    request.input.discount = undefined;
    request.input.tax = undefined;
    request.input.payments = [{ method: 'cash', amount: '400.00' }];
    const invoice = await repository.complete(request);
    const tickets = await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.invoiceId, invoice.id));
    await repository.reassignQueue({
      invoiceId: invoice.id, serviceQueueEntryId: tickets[1]!.id,
      input: { branchId: data.branchId, employeeId: data.sellerEmployeeId,
        reason: 'Correct performer', operationReference: crypto.randomUUID() },
      actingAccountId: data.accountId, actingAccountRole: 'cashier', reassignedAt: data.at,
      assertEmployee: async () => ({ id: data.sellerEmployeeId, employeeCode: data.employeeCode + 1,
        fullName: `Seller ${data.marker}`, branchId: data.branchId }),
    });
    const realPayroll = createErpPayrollCapability(database);
    const locked = new Set<number>();
    const reversing = createDrizzleSaleRepository(database, createErpAuditCapability(), {
      async lockCommissionEmployee(employeeId, context) {
        await realPayroll.lockCommissionEmployee(employeeId, context);
        locked.add(employeeId);
      },
      async projectCommission(input, context) {
        if (!locked.has(input.employeeId)) throw new Error('Refund projected an unlocked employee');
        return realPayroll.projectCommission(input, context);
      },
      recordPostPayrollDeduction: (input, context) => (
        realPayroll.recordPostPayrollDeduction(input, context)
      ),
    });
    await reversing.reverse({
      type: 'refund', invoiceId: invoice.id,
      input: { branchId: data.branchId, idempotencyKey: crypto.randomUUID(),
        reason: 'One service refunded', lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '200.00' }] },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin', reversedAt: data.at,
    });
    const reversals = await database.select().from(commissionLedgerEntries).where(and(
      eq(commissionLedgerEntries.invoiceId, invoice.id),
      eq(commissionLedgerEntries.entryType, 'reversal'),
    ));
    expect(reversals).toEqual([expect.objectContaining({
      employeeId: data.sellerEmployeeId, serviceQueueEntryId: tickets[1]!.id,
      amount: '-30.00',
    })]);
    await database.update(serviceQueueEntries).set({
      status: 'completed', completedAt: data.at, completedByAccountId: data.adminAccountId,
    }).where(eq(serviceQueueEntries.id, tickets[1]!.id));
    await expect(repository.reassignQueue({
      invoiceId: invoice.id, serviceQueueEntryId: tickets[1]!.id,
      input: { branchId: data.branchId, employeeId: data.employeeId,
        reason: 'Already refunded', operationReference: crypto.randomUUID() },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin', reassignedAt: data.at,
      assertEmployee: async () => ({ id: data.employeeId, employeeCode: data.employeeCode,
        fullName: `Employee ${data.marker}`, branchId: data.branchId }),
    })).rejects.toMatchObject({ code: 'INVOICE_NOT_REASSIGNABLE' });
  });

  it('refunds an unfinished ticket before a higher-numbered completed and recorded ticket', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(database, createErpAuditCapability());
    const request = operation(data, crypto.randomUUID());
    request.input.lines = [{ itemType: 'service', serviceId: data.serviceId, quantity: 2,
      unitPrice: '200.00', employeeId: data.employeeId }];
    request.input.discount = undefined;
    request.input.tax = undefined;
    request.input.payments = [{ method: 'cash', amount: '400.00' }];
    const invoice = await repository.complete(request);
    const tickets = await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.invoiceId, invoice.id));
    const [first, last] = tickets;

    await repository.reassignQueue({
      invoiceId: invoice.id, serviceQueueEntryId: last!.id,
      input: { branchId: data.branchId, employeeId: data.sellerEmployeeId,
        reason: 'Correct performer', operationReference: crypto.randomUUID() },
      actingAccountId: data.accountId, actingAccountRole: 'cashier', reassignedAt: data.at,
      assertEmployee: async () => ({ id: data.sellerEmployeeId,
        employeeCode: data.employeeCode + 1, fullName: `Seller ${data.marker}`,
        branchId: data.branchId }),
    });
    await database.update(serviceQueueEntries).set({
      status: 'completed', completedAt: data.at, completedByAccountId: data.accountId,
    }).where(eq(serviceQueueEntries.id, last!.id));
    await database.insert(serviceConsumptionReports).values({
      serviceQueueEntryId: last!.id, revision: 1, isCurrent: true,
      completionKind: 'none', actingAccountId: data.accountId, createdAt: data.at,
    });

    await repository.reverse({
      type: 'refund', invoiceId: invoice.id,
      input: { branchId: data.branchId, idempotencyKey: crypto.randomUUID(),
        reason: 'One unperformed service refunded',
        lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '200.00' }] },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin', reversedAt: data.at,
    });

    const currentTickets = await database.select().from(serviceQueueEntries)
      .where(eq(serviceQueueEntries.invoiceId, invoice.id));
    expect(currentTickets.find((ticket) => ticket.id === first!.id)?.status).toBe('canceled');
    expect(currentTickets.find((ticket) => ticket.id === last!.id)?.status).toBe('completed');
    const reversals = await database.select().from(commissionLedgerEntries).where(and(
      eq(commissionLedgerEntries.invoiceId, invoice.id),
      eq(commissionLedgerEntries.entryType, 'reversal'),
    ));
    expect(reversals).toEqual([expect.objectContaining({
      serviceQueueEntryId: first!.id, employeeId: data.employeeId, amount: '-30.00',
    })]);
  });
});
