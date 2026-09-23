import {
  accounts,
  auditEvents,
  branches,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  employees,
  erpCategories,
  erpCommissionPayouts,
  erpExpenses,
  erpServices,
  invoiceLines,
  invoicePayments,
  invoices,
  payrollMonths,
} from '@capella/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDrizzleCommissionRepository } from '../../src/modules/erp/commissions/index.js';
import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleExpenseRepository } from '../../src/modules/erp/expenses/expense-repository.js';
import {
  closeMysqlIntegrationDatabase,
  createMysqlIntegrationDatabase,
  prepareMysqlIntegrationDatabase,
} from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();
const repository = createDrizzleCommissionRepository(database, {
  now: () => new Date('2026-08-05T11:00:00.000Z'),
  audit: createErpAuditCapability(),
});
const at = new Date('2026-08-05T10:00:00.000Z');

let branchId: number;
let employeeId: number;
let accountId: number;

beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  branchId = Number((await database.insert(branches).values({
    name: 'Commission payout branch', nameNormalized: 'commission-payout-branch', location: 'Cairo',
    latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 100,
    createdAt: at, updatedAt: at,
  }))[0].insertId);
  employeeId = Number((await database.insert(employees).values({
    employeeCode: 1_720_000_001, fullName: 'Commission Payout Employee',
    personalPhone: '01017200001', whatsappPhone: '01117200001', pinHash: 'unused',
    age: 30, address: 'Cairo', branchId, shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00', createdAt: at, updatedAt: at,
  }))[0].insertId);
  accountId = Number((await database.insert(accounts).values({
    username: 'payout.admin', passwordHash: 'unused', role: 'admin',
    createdAt: at, updatedAt: at,
  }))[0].insertId);
  await seedCommission('2026-08', '1000.00');
}, 180_000);

afterAll(async () => {
  await closeMysqlIntegrationDatabase(database);
}, 30_000);

async function seedCommission(month: string, amount: string) {
  const soldAt = new Date(`${month}-05T10:00:00.000Z`);
  const openSessions = await database.select({ id: cashierSessions.id }).from(cashierSessions)
    .where(and(eq(cashierSessions.branchId, branchId), isNull(cashierSessions.closedAt)));
  for (const session of openSessions) {
    const opened = (await database.select({ openedAt: cashierSessions.openedAt })
      .from(cashierSessions).where(eq(cashierSessions.id, session.id)).limit(1))[0];
    const openedAt = opened?.openedAt ?? soldAt;
    const closedAt = new Date(Math.max(openedAt.getTime() + 1000, soldAt.getTime()));
    await database.update(cashierSessions)
      .set({ closedAt, closedByAccountId: accountId })
      .where(eq(cashierSessions.id, session.id));
  }
  const clientId = Number((await database.insert(clients).values({
    branchId, fullName: 'Commission Seed Client', createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  const categoryId = Number((await database.insert(erpCategories).values({
    branchId, type: 'service', name: `Seed ${month}`, nameNormalized: `seed-${month}`,
    createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  const serviceId = Number((await database.insert(erpServices).values({
    branchId, categoryId, name: `Seed service ${month}`, nameNormalized: `seed-svc-${month}`,
    price: amount, commissionPercent: '0.00', createdAt: soldAt, updatedAt: soldAt,
  }))[0].insertId);
  const sessionId = Number((await database.insert(cashierSessions).values({
    branchId, openedByAccountId: accountId, openedAt: soldAt,
  }))[0].insertId);
  const invoiceId = Number((await database.insert(invoices).values({
    branchId, clientId, sellerEmployeeId: employeeId, actingAccountId: accountId,
    cashierSessionId: sessionId, invoiceNumber: `SEED-${month}-${employeeId}`,
    idempotencyKey: crypto.randomUUID(), status: 'draft', kind: 'sale',
    clientNameSnapshot: 'Commission Seed Client', sellerNameSnapshot: 'Commission Payout Employee',
    authorizedBySnapshot: 'payout.admin', subtotal: amount, discountAmount: '0.00',
    taxAmount: '0.00', total: amount, amountPaid: amount, settlementStatus: 'settled',
    soldAt, createdAt: soldAt,
  }))[0].insertId);
  const lineId = Number((await database.insert(invoiceLines).values({
    invoiceId, branchId, lineNumber: 1, itemType: 'service', serviceId,
    itemNameSnapshot: `Seed service ${month}`, employeeId,
    employeeNameSnapshot: 'Commission Payout Employee', employeeCodeSnapshot: 1_720_000_001,
    quantity: 1, unitPrice: amount, lineTotal: amount,
    commissionRuleSnapshot: 'service_default', commissionRateSnapshot: '100.00',
    commissionAmountSnapshot: amount,
  }))[0].insertId);
  await database.insert(commissionLedgerEntries).values({
    invoiceId, invoiceLineId: lineId, employeeId, actingAccountId: accountId,
    entryType: 'earned', commissionRuleSnapshot: 'service_default',
    commissionRateSnapshot: '100.00', baseAmount: amount, amount, createdAt: soldAt,
  });
  await database.insert(invoicePayments).values({
    invoiceId, method: 'cash', amount, operationReference: crypto.randomUUID(),
    isInitial: true, cashierSessionId: sessionId, actingAccountId: accountId,
    paidAt: soldAt, createdAt: soldAt,
  });
  await database.update(invoices).set({ status: 'completed' }).where(eq(invoices.id, invoiceId));
}

describe('commission payout repository', () => {
  it('rejects a payout when available balance is zero after full payment', async () => {
    const first = await repository.createPayout({
      branchId, accountId, employeeId, month: '2026-08', amount: '200.00', reason: 'دفعة جزئية',
    });
    expect(first.kind).toBe('success');
    if (first.kind !== 'success') return;
    expect(first.summary).toMatchObject({
      paidAmount: '200.00', availableAmount: '800.00', netAmount: '1000.00',
    });

    const expense = (await database.select().from(erpExpenses)
      .where(eq(erpExpenses.id, first.payout.expenseId)).limit(1))[0];
    expect(expense).toMatchObject({
      branchId, name: 'صرف عمولة', amount: '200.00', kind: 'expense', status: 'active',
    });
    expect((await database.select().from(erpCommissionPayouts)
      .where(eq(erpCommissionPayouts.id, first.payout.id)).limit(1))[0])
      .toMatchObject({ employeeId, amount: '200.00', expenseId: first.payout.expenseId });
    expect((await database.select({ action: auditEvents.action, relatedIds: auditEvents.relatedIds })
      .from(auditEvents).where(and(
        eq(auditEvents.module, 'erp-commissions'),
        eq(auditEvents.entityId, String(first.payout.id)),
      )).limit(1))[0]).toMatchObject({
      action: 'payout', relatedIds: { actingAccountId: String(accountId), expenseId: String(first.payout.expenseId) },
    });

    await expect(repository.createPayout({
      branchId, accountId, employeeId, month: '2026-08', amount: '800.01',
    })).resolves.toEqual({ kind: 'insufficient_available' });

    const rest = await repository.createPayout({
      branchId, accountId, employeeId, month: '2026-08', amount: '800.00',
    });
    expect(rest.kind).toBe('success');
    if (rest.kind !== 'success') return;
    expect(rest.summary).toMatchObject({ paidAmount: '1000.00', availableAmount: '0.00' });

    await expect(repository.createPayout({
      branchId, accountId, employeeId, month: '2026-08', amount: '0.01',
    })).resolves.toEqual({ kind: 'insufficient_available' });
  });

  it('rejects payout for a finalized payroll month', async () => {
    await seedCommission('2026-07', '500.00');
    const finalizedAt = new Date('2026-08-01T09:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId, payrollMonth: '2026-07-01', status: 'finalized',
      baseSalary: '5000.00', proratedBase: '5000.00', overtimeAmount: '0.00',
      bonusAmount: '0.00', commissionAmount: '500.00', attendanceDeductionAmount: '0.00',
      manualDeductionAmount: '0.00', commissionDeductionAmount: '0.00', advanceAmount: '0.00',
      priorNegativeCarry: '0.00', deactivationAdjustmentAmount: '0.00', netSalary: '5500.00',
      eligibleWorkdays: 30, fullMonthWorkdays: 30, requiredMinutes: 9000,
      overtimeMinutes: 0, shortageMinutes: 0, finalizedAt,
      createdAt: finalizedAt, updatedAt: finalizedAt,
    });

    await expect(repository.createPayout({
      branchId, accountId, employeeId, month: '2026-07', amount: '10.00',
    })).resolves.toEqual({ kind: 'finalized' });
  });

  it('rejects unknown employees', async () => {
    await expect(repository.createPayout({
      branchId, accountId, employeeId: 999_999, month: '2026-08', amount: '1.00',
    })).resolves.toEqual({ kind: 'employee_not_found' });
  });

  it('prevents correcting the expense linked to a commission payout', async () => {
    const payout = (await database.select({ expenseId: erpCommissionPayouts.expenseId })
      .from(erpCommissionPayouts).where(eq(erpCommissionPayouts.employeeId, employeeId)).limit(1))[0];
    const expenses = createDrizzleExpenseRepository(database, { record: async () => {} });
    await expect(expenses.correct(payout!.expenseId, {
      branchId, actingAccountId: accountId, name: 'different', amount: '1.00',
      expenseDate: '2026-08-05', description: '', reason: 'mistake',
    })).resolves.toBe('invalid-target');
  });

  it('reserves an earlier unfinalized overpayment against the next month', async () => {
    const extraExpenseId = Number((await database.insert(erpExpenses).values({
      branchId, name: 'صرف عمولة', amount: '100.00', expenseDate: '2026-08-05',
      description: 'payout later overdrawn by a refund', actingAccountId: accountId,
      createdAt: new Date('2026-08-05T11:00:00.000Z'),
    }))[0].insertId);
    await database.insert(erpCommissionPayouts).values({
      employeeId, commissionMonth: '2026-08-01', branchId, amount: '100.00',
      expenseId: extraExpenseId, actingAccountId: accountId,
      createdAt: new Date('2026-08-05T11:00:00.000Z'),
    });
    await seedCommission('2026-09', '250.00');
    await expect(repository.summary(employeeId, '2026-09')).resolves.toMatchObject({
      netAmount: '250.00', availableAmount: '150.00',
    });
  });

  it('uses commission earned in an intervening open month to clear finalized carry', async () => {
    const finalizedAt = new Date('2026-09-01T09:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId, payrollMonth: '2026-08-01', status: 'finalized',
      baseSalary: '5000.00', proratedBase: '5000.00', overtimeAmount: '0.00',
      bonusAmount: '0.00', commissionAmount: '1000.00',
      commissionPaidAmount: '1100.00', commissionCarryAmount: '100.00',
      attendanceDeductionAmount: '0.00', manualDeductionAmount: '0.00',
      commissionDeductionAmount: '0.00', advanceAmount: '0.00', priorNegativeCarry: '0.00',
      deactivationAdjustmentAmount: '0.00', netSalary: '5000.00',
      eligibleWorkdays: 30, fullMonthWorkdays: 30, requiredMinutes: 9000,
      overtimeMinutes: 0, shortageMinutes: 0, finalizedAt,
      createdAt: finalizedAt, updatedAt: finalizedAt,
    });
    await seedCommission('2026-10', '100.00');
    await expect(repository.summary(employeeId, '2026-10')).resolves.toMatchObject({
      netAmount: '100.00', availableAmount: '100.00',
    });
  });

  it('does not record a cash payout or expense when the branch drawer is closed', async () => {
    await seedCommission('2026-11', '100.00');
    await database.update(cashierSessions)
      .set({ closedAt: new Date('2026-11-05T11:00:00.000Z'), closedByAccountId: accountId })
      .where(and(eq(cashierSessions.branchId, branchId), isNull(cashierSessions.closedAt)));
    const before = await database.select({ id: erpExpenses.id }).from(erpExpenses);
    await expect(repository.createPayout({
      branchId, accountId, employeeId, month: '2026-11', amount: '10.00',
    })).resolves.toEqual({ kind: 'shift_not_open' });
    expect(await database.select({ id: erpExpenses.id }).from(erpExpenses)).toHaveLength(before.length);
  });
});
