import {
  accounts,
  erpCommissionPayrollInputs,
  erpPostPayrollDeductions,
  payrollMonths,
} from '@capella/database/schema';
import { eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleCommissionRepository } from '../../src/modules/erp/commissions/index.js';
import { createDrizzleSaleRepository } from '../../src/modules/erp/sales/sale-repository.js';
import { createErpPayrollCapability, type ErpPayrollCapability } from '../../src/modules/payroll/index.js';
import { closeMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';
import { createSaleRepositoryMysqlFixtures } from './sale-repository-mysql-fixtures.js';

const erp17Migration = readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/database/migrations/0056_confused_ulik.sql',
), 'utf8');
const erp17Backfill = erp17Migration.split('--> statement-breakpoint')
  .find((statement) => statement.includes('INSERT INTO `erp_commission_payroll_inputs`'))?.trim();
if (!erp17Backfill) throw new Error('ERP 17 commission backfill statement is missing');

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
  it('projects the changing net commission into one live payroll input', async () => {
    const data = await fixture();
    const payroll = createErpPayrollCapability(database);
    const repository = createDrizzleSaleRepository(
      database,
      createErpAuditCapability(),
      payroll,
    );
    const completed = await repository.complete(operation(data, crypto.randomUUID()));

    expect(completed.seller).toMatchObject({
      id: data.sellerEmployeeId,
      name: `Seller ${data.marker}`,
    });
    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, data.employeeId),
    )).toEqual([expect.objectContaining({
      payrollMonth: '2026-08-01', amount: '30.00',
      reference: `erp-commission:2026-08:${data.employeeId}`,
    })]);

    await repository.reverse({
      type: 'refund',
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Commission reversal before payroll finalization',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin',
      reversedAt: new Date('2026-09-01T09:00:00.000Z'),
    });

    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, data.employeeId),
    )).toEqual([expect.objectContaining({ amount: '0.00' })]);
  });

  it('serializes concurrent reversals before recalculating the employee-month projection', async () => {
    const data = await fixture();
    const realPayroll = createErpPayrollCapability(database);
    const completing = createDrizzleSaleRepository(database, createErpAuditCapability(), realPayroll);
    const first = await completing.complete(operation(data, crypto.randomUUID()));
    const secondOperation = operation(data, crypto.randomUUID());
    secondOperation.invoiceNumber = `${secondOperation.invoiceNumber}-2`;
    const second = await completing.complete(secondOperation);

    let lockArrivals = 0;
    let projectArrivals = 0;
    let releaseLocks!: () => void;
    let releaseProjects!: () => void;
    const lockGate = new Promise<void>((resolve) => { releaseLocks = resolve; });
    const projectGate = new Promise<void>((resolve) => { releaseProjects = resolve; });
    const coordinatedPayroll: ErpPayrollCapability = {
      async lockCommissionEmployee(employeeId, context) {
        lockArrivals += 1;
        if (lockArrivals === 2) releaseLocks();
        await lockGate;
        await realPayroll.lockCommissionEmployee(employeeId, context);
      },
      async projectCommission(input, context) {
        if (lockArrivals === 0) {
          projectArrivals += 1;
          if (projectArrivals === 2) releaseProjects();
          await projectGate;
        }
        return realPayroll.projectCommission(input, context);
      },
      recordPostPayrollDeduction: (input, context) => (
        realPayroll.recordPostPayrollDeduction(input, context)
      ),
    };
    const reversing = createDrizzleSaleRepository(
      database,
      createErpAuditCapability(),
      coordinatedPayroll,
    );
    const reverse = (invoiceId: number) => reversing.reverse({
      type: 'refund', invoiceId,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'Concurrent refund',
        lines: [{ invoiceLineId: invoiceId === first.id ? first.lines[0]!.id : second.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date('2026-09-01T09:00:00.000Z'),
    });

    await Promise.all([reverse(first.id), reverse(second.id)]);

    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, data.employeeId),
    )).toEqual([expect.objectContaining({ amount: '0.00' })]);
  });

  it('turns a commission reversal after payroll finalization into an idempotent deduction', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(
      database,
      createErpAuditCapability(),
      createErpPayrollCapability(database),
    );
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const finalizedAt = new Date('2026-09-01T08:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId: data.employeeId, payrollMonth: '2026-08-01',
      baseSalary: '5000.00', proratedBase: '5000.00', overtimeAmount: '0.00',
      bonusAmount: '0.00', commissionAmount: '30.00', attendanceDeductionAmount: '0.00',
      manualDeductionAmount: '0.00', commissionDeductionAmount: '0.00', advanceAmount: '0.00',
      priorNegativeCarry: '0.00', netSalary: '5030.00', eligibleWorkdays: 31,
      fullMonthWorkdays: 31, requiredMinutes: 14880, overtimeMinutes: 0, shortageMinutes: 0,
      finalizedAt, createdAt: finalizedAt, updatedAt: finalizedAt,
    });
    const command = {
      type: 'refund' as const,
      invoiceId: completed.id,
      input: {
        branchId: data.branchId,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Commission reversal after payroll finalization',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash' as const, amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin' as const,
      reversedAt: new Date('2026-09-01T09:00:00.000Z'),
    };

    const refunded = await repository.reverse(command);
    await expect(repository.reverse(command)).resolves.toEqual(refunded);

    expect(await database.select().from(erpPostPayrollDeductions).where(
      eq(erpPostPayrollDeductions.employeeId, data.employeeId),
    )).toEqual([expect.objectContaining({
      payrollMonth: '2026-09-01', amount: '30.00',
      reference: expect.stringMatching(/^erp-commission-reversal:\d+:/),
    })]);
  });

  it('does not deduct a legacy commission that was never snapshotted into finalized payroll', async () => {
    const data = await fixture();
    const repository = createDrizzleSaleRepository(
      database,
      createErpAuditCapability(),
      createErpPayrollCapability(database),
    );
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const finalizedAt = new Date('2026-09-01T08:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId: data.employeeId, payrollMonth: '2026-08-01',
      baseSalary: '5000.00', proratedBase: '5000.00', overtimeAmount: '0.00',
      bonusAmount: '0.00', commissionAmount: '0.00', attendanceDeductionAmount: '0.00',
      manualDeductionAmount: '0.00', commissionDeductionAmount: '0.00', advanceAmount: '0.00',
      priorNegativeCarry: '0.00', netSalary: '5000.00', eligibleWorkdays: 31,
      fullMonthWorkdays: 31, requiredMinutes: 14880, overtimeMinutes: 0, shortageMinutes: 0,
      finalizedAt, createdAt: finalizedAt, updatedAt: finalizedAt,
    });

    await repository.reverse({
      type: 'refund', invoiceId: completed.id,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'Legacy unpaid commission',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date('2026-09-01T09:00:00.000Z'),
    });

    expect(await database.select().from(erpPostPayrollDeductions).where(
      eq(erpPostPayrollDeductions.employeeId, data.employeeId),
    )).toHaveLength(0);
  });

  it('backfills existing ledger commission only when payroll is still open', async () => {
    const open = await fixture();
    const finalized = await fixture();
    const repository = createDrizzleSaleRepository(
      database,
      createErpAuditCapability(),
      createErpPayrollCapability(database),
    );
    await repository.complete(operation(open, crypto.randomUUID()));
    await repository.complete(operation(finalized, crypto.randomUUID()));
    const finalizedAt = new Date('2026-09-01T08:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId: finalized.employeeId, payrollMonth: '2026-08-01',
      baseSalary: '5000.00', proratedBase: '5000.00', overtimeAmount: '0.00',
      bonusAmount: '0.00', commissionAmount: '0.00', attendanceDeductionAmount: '0.00',
      manualDeductionAmount: '0.00', commissionDeductionAmount: '0.00', advanceAmount: '0.00',
      priorNegativeCarry: '0.00', netSalary: '5000.00', eligibleWorkdays: 31,
      fullMonthWorkdays: 31, requiredMinutes: 14880, overtimeMinutes: 0, shortageMinutes: 0,
      finalizedAt, createdAt: finalizedAt, updatedAt: finalizedAt,
    });
    await database.delete(erpCommissionPayrollInputs);

    await database.execute(sql.raw(erp17Backfill));

    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, open.employeeId),
    )).toEqual([expect.objectContaining({ amount: '30.00', payrollMonth: '2026-08-01' })]);
    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.employeeId, finalized.employeeId),
    )).toHaveLength(0);
  });

  it('reads employee/month totals with invoice-line and reversal traceability', async () => {
    const data = await fixture();
    const sales = createDrizzleSaleRepository(database, createErpAuditCapability());
    const completed = await sales.complete(operation(data, crypto.randomUUID()));
    await sales.reverse({
      type: 'refund', invoiceId: completed.id,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(), reason: 'Trace me',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date('2026-09-01T09:00:00.000Z'),
    });
    const commissions = createDrizzleCommissionRepository(database, { audit: createErpAuditCapability() });

    await expect(commissions.summary(data.employeeId, '2026-08')).resolves.toMatchObject({
      employeeId: data.employeeId, earnedAmount: '30.00', reversedAmount: '30.00',
      netAmount: '0.00', invoiceLineCount: 1, reversalCount: 1,
    });
    await expect(commissions.detail(data.branchId, data.employeeId, '2026-08'))
      .resolves.toMatchObject({
        entries: [
          expect.objectContaining({ type: 'earned', invoiceId: completed.id, amount: '30.00' }),
          expect.objectContaining({ type: 'reversal', reversalId: expect.any(Number), amount: '-30.00' }),
        ],
      });
    await expect(commissions.list(data.branchId, {
      month: '2026-08', page: 1, pageSize: 20,
    })).resolves.toMatchObject({ items: [expect.objectContaining({ employeeId: data.employeeId })], total: 1 });
  });
});
