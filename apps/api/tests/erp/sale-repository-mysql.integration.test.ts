import {
  accounts,
  advances,
  erpExpenses,
} from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdvanceModule } from '../../src/modules/advances/index.js';
import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleCashierSessionRepository } from '../../src/modules/erp/sales/cashier-sessions-repository.js';
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
  it('deducts branch expenses made during a shift from its cash and total net', async () => {
    const data = await fixture();
    const sales = createDrizzleSaleRepository(database, createErpAuditCapability());
    const shifts = createDrizzleCashierSessionRepository(database, createErpAuditCapability());
    await sales.complete(operation(data, crypto.randomUUID()));
    await database.insert(erpExpenses).values({
      branchId: data.branchId,
      name: 'Shift supplies',
      amount: '30.00',
      expenseDate: '2026-08-03',
      description: '',
      actingAccountId: data.accountId,
      createdAt: new Date(data.at.getTime() + 60_000),
    });

    expect(await shifts.findMoneyById(data.cashierSessionId)).toMatchObject({
      expenses: '30.00',
      takenTotal: '185.00',
      refundedTotal: '0.00',
      net: '155.00',
    });
  });

  it('assigns an expense at a session handoff to exactly one shift', async () => {
    const data = await fixture();
    const shifts = createDrizzleCashierSessionRepository(database, createErpAuditCapability());
    const handoff = new Date(data.at.getTime() + 60_000);
    await shifts.close({
      branchId: data.branchId,
      closedByAccountId: data.accountId,
      closedAt: handoff,
    });
    const next = await shifts.open({
      branchId: data.branchId,
      openedByAccountId: data.accountId,
      openedAt: handoff,
    });
    if (next.kind !== 'success') throw new Error('expected the next session to open');
    await database.insert(erpExpenses).values({
      branchId: data.branchId,
      name: 'Handoff expense',
      amount: '30.00',
      expenseDate: '2026-08-03',
      description: '',
      actingAccountId: data.accountId,
      createdAt: handoff,
    });

    expect(await shifts.findMoneyById(data.cashierSessionId)).toMatchObject({ expenses: '0.00' });
    expect(await shifts.findMoneyById(next.session.id)).toMatchObject({ expenses: '30.00' });
    expect(await shifts.readReportAccounting({
      sessionId: data.cashierSessionId,
      branchId: data.branchId,
      openedAt: data.at,
      closedAt: handoff,
    })).toMatchObject({ expenses: '0.00' });
    expect(await shifts.readReportAccounting({
      sessionId: next.session.id,
      branchId: data.branchId,
      openedAt: handoff,
      closedAt: new Date(handoff.getTime() + 60_000),
    })).toMatchObject({ expenses: '30.00' });
  });

  it('records a cash advance as a till expense and deducts it from the shift', async () => {
    const data = await fixture();
    const sales = createDrizzleSaleRepository(database, createErpAuditCapability());
    const shifts = createDrizzleCashierSessionRepository(database, createErpAuditCapability());
    await sales.complete(operation(data, crypto.randomUUID()));
    const paidAt = new Date(data.at.getTime() + 60_000);
    const created = await createAdvanceModule(database, { now: () => paidAt }).service.create({
      employeeId: data.employeeId,
      amount: '40.00',
      installmentCount: 1,
      startMonth: '2026-08',
      reason: 'سلفة نقدية',
    });

    const expense = (await database.select().from(erpExpenses)
      .where(eq(erpExpenses.branchId, data.branchId)))
      .find((row) => row.name === 'سلفة');
    expect(expense).toMatchObject({
      name: 'سلفة',
      amount: '40.00',
      expenseDate: '2026-08-03',
      description: `advance for employee Employee ${data.marker}`,
      createdAt: paidAt,
    });
    expect(await shifts.findMoneyById(data.cashierSessionId)).toMatchObject({
      expenses: '40.00',
      takenTotal: '185.00',
      refundedTotal: '0.00',
      net: '145.00',
    });
    expect(await shifts.readReportAccounting({
      sessionId: data.cashierSessionId,
      branchId: data.branchId,
      openedAt: data.at,
      closedAt: new Date(data.at.getTime() + 120_000),
    })).toMatchObject({ expenses: '40.00' });
    const linked = (await database.select({ expenseId: advances.expenseId })
      .from(advances).where(eq(advances.id, created.id)))[0];
    expect(linked?.expenseId).toBe(expense!.id);
  });

  it('replaces the linked till expense when the advance amount changes and reverses it on delete', async () => {
    const data = await fixture();
    const shifts = createDrizzleCashierSessionRepository(database, createErpAuditCapability());
    const module = createAdvanceModule(database, { now: () => new Date(data.at.getTime() + 60_000) });
    const created = await module.service.create({
      employeeId: data.employeeId,
      amount: '40.00',
      installmentCount: 1,
      startMonth: '2026-08',
      reason: 'سلفة نقدية',
    });
    await module.service.update(created.id, { amount: '25.00' });
    expect(await shifts.findMoneyById(data.cashierSessionId)).toMatchObject({ expenses: '25.00' });
    await module.service.remove(created.id);
    expect(await shifts.findMoneyById(data.cashierSessionId)).toMatchObject({ expenses: '0.00' });
  });

  it('refuses to cash out an advance against an inactive admin account', async () => {
    const data = await fixture();
    await database.update(accounts).set({ active: false }).where(eq(accounts.role, 'admin'));
    await expect(createAdvanceModule(database, { now: () => new Date(data.at.getTime() + 60_000) })
      .service.create({
        employeeId: data.employeeId,
        amount: '10.00',
        installmentCount: 1,
        startMonth: '2026-08',
        reason: 'سلفة نقدية',
      })).rejects.toThrow('Advance cash-out requires an admin account');
    await database.update(accounts).set({ active: true }).where(eq(accounts.role, 'admin'));
  });

  it('assigns an advance expense at a session handoff to exactly one shift', async () => {
    const data = await fixture();
    const shifts = createDrizzleCashierSessionRepository(database, createErpAuditCapability());
    const handoff = new Date(data.at.getTime() + 60_000);
    await shifts.close({
      branchId: data.branchId,
      closedByAccountId: data.accountId,
      closedAt: handoff,
    });
    const next = await shifts.open({
      branchId: data.branchId,
      openedByAccountId: data.accountId,
      openedAt: handoff,
    });
    if (next.kind !== 'success') throw new Error('expected the next session to open');
    await createAdvanceModule(database, { now: () => handoff }).service.create({
      employeeId: data.employeeId,
      amount: '40.00',
      installmentCount: 1,
      startMonth: '2026-08',
      reason: 'سلفة نقدية',
    });

    expect(await shifts.findMoneyById(data.cashierSessionId)).toMatchObject({ expenses: '0.00' });
    expect(await shifts.findMoneyById(next.session.id)).toMatchObject({ expenses: '40.00' });
    expect(await shifts.readReportAccounting({
      sessionId: data.cashierSessionId,
      branchId: data.branchId,
      openedAt: data.at,
      closedAt: handoff,
    })).toMatchObject({ expenses: '0.00' });
    expect(await shifts.readReportAccounting({
      sessionId: next.session.id,
      branchId: data.branchId,
      openedAt: handoff,
      closedAt: new Date(handoff.getTime() + 60_000),
    })).toMatchObject({ expenses: '40.00' });
  });
});
