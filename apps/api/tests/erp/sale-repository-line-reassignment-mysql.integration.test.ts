import {
  accounts,
  commissionLedgerEntries,
  employees,
  erpCommissionPayrollInputs,
  invoiceLineReassignments,
  payrollMonths,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
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
  it('atomically reassigns a service, moves commission, updates payroll, and replays retries', async () => {
    const data = await fixture();
    const targetEmployeeId = Number((await database.insert(employees).values({
      employeeCode: data.employeeCode + 2,
      fullName: `Target ${data.marker}`,
      personalPhone: `010${String(Number(data.clientPhone.slice(3)) + 1).padStart(8, '0')}`,
      whatsappPhone: `011${String(Number(data.clientPhone.slice(3)) + 1).padStart(8, '0')}`,
      pinHash: 'unused', age: 30, address: 'Cairo', branchId: data.branchId,
      shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00',
      createdAt: data.at, updatedAt: data.at,
    }))[0].insertId);
    const repository = createDrizzleSaleRepository(
      database, createErpAuditCapability(), createErpPayrollCapability(database),
    );
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const command = {
      invoiceId: completed.id,
      invoiceLineId: completed.lines[0]!.id,
      input: {
        branchId: data.branchId,
        employeeId: targetEmployeeId,
        operationReference: crypto.randomUUID(),
        reason: 'Actual performer',
      },
      actingAccountId: data.adminAccountId,
      actingAccountRole: 'admin' as const,
      reassignedAt: new Date('2026-08-03T12:00:00.000Z'),
      assertEmployee: async () => ({
        id: targetEmployeeId, employeeCode: data.employeeCode + 2,
        fullName: `Target ${data.marker}`, branchId: data.branchId,
      }),
    };

    const [reassigned, replayed] = await Promise.all([
      repository.reassignLine(command), repository.reassignLine(command),
    ]);
    expect(replayed).toEqual(reassigned);

    expect(reassigned.lines[0]).toMatchObject({
      employee: { id: targetEmployeeId, name: `Target ${data.marker}` },
      originalEmployee: { id: data.employeeId, name: `Employee ${data.marker}` },
      reassignments: [expect.objectContaining({
        fromEmployee: expect.objectContaining({ id: data.employeeId }),
        toEmployee: expect.objectContaining({ id: targetEmployeeId }),
        reason: 'Actual performer',
      })],
    });
    expect(await database.select().from(invoiceLineReassignments).where(
      eq(invoiceLineReassignments.invoiceLineId, completed.lines[0]!.id),
    )).toHaveLength(1);
    expect(await database.select().from(commissionLedgerEntries).where(
      eq(commissionLedgerEntries.invoiceLineId, completed.lines[0]!.id),
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: data.employeeId, entryType: 'reassignment_out', amount: '-30.00' }),
      expect.objectContaining({ employeeId: targetEmployeeId, entryType: 'reassignment_in', amount: '30.00' }),
    ]));
    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.payrollMonth, '2026-08-01'),
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: data.employeeId, amount: '0.00' }),
      expect.objectContaining({ employeeId: targetEmployeeId, amount: '30.00' }),
    ]));

    await repository.reverse({
      type: 'refund', invoiceId: completed.id,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(),
        reason: 'Refund after correction',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '185.00' }],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date('2026-08-03T12:05:00.000Z'),
    });
    expect(await database.select().from(commissionLedgerEntries).where(and(
      eq(commissionLedgerEntries.invoiceLineId, completed.lines[0]!.id),
      eq(commissionLedgerEntries.entryType, 'reversal'),
    ))).toEqual([expect.objectContaining({ employeeId: targetEmployeeId, amount: '-30.00' })]);
    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.payrollMonth, '2026-08-01'),
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: data.employeeId, amount: '0.00' }),
      expect.objectContaining({ employeeId: targetEmployeeId, amount: '0.00' }),
    ]));
    await expect(repository.reassignLine({
      ...command,
      input: {
        ...command.input,
        employeeId: data.employeeId,
        operationReference: crypto.randomUUID(),
        reason: 'Too late after refund',
      },
      assertEmployee: async () => ({
        id: data.employeeId, employeeCode: data.employeeCode,
        fullName: `Employee ${data.marker}`, branchId: data.branchId,
      }),
    })).rejects.toMatchObject({ code: 'INVOICE_NOT_REASSIGNABLE' });
  });

  it('reassigns only the unrefunded commission after a partial service refund', async () => {
    const data = await fixture();
    const targetEmployeeId = Number((await database.insert(employees).values({
      employeeCode: data.employeeCode + 2,
      fullName: `Partial target ${data.marker}`,
      personalPhone: `010${String(Number(data.clientPhone.slice(3)) + 2).padStart(8, '0')}`,
      whatsappPhone: `011${String(Number(data.clientPhone.slice(3)) + 2).padStart(8, '0')}`,
      pinHash: 'unused', age: 30, address: 'Cairo', branchId: data.branchId,
      shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00',
      createdAt: data.at, updatedAt: data.at,
    }))[0].insertId);
    const repository = createDrizzleSaleRepository(
      database, createErpAuditCapability(), createErpPayrollCapability(database),
    );
    const sale = operation(data, crypto.randomUUID());
    sale.input.lines[0] = { ...sale.input.lines[0]!, quantity: 5 };
    sale.input.payments = [{ method: 'cash', amount: '905.00' }];
    const completed = await repository.complete(sale);
    await repository.reverse({
      type: 'refund', invoiceId: completed.id,
      input: {
        branchId: data.branchId, idempotencyKey: crypto.randomUUID(),
        reason: 'One unit refunded',
        lines: [{ invoiceLineId: completed.lines[0]!.id, quantity: 1 }],
        payments: [{ method: 'cash', amount: '181.00' }],
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reversedAt: new Date('2026-08-03T12:00:00.000Z'),
    });

    const reassigned = await repository.reassignLine({
      invoiceId: completed.id,
      invoiceLineId: completed.lines[0]!.id,
      input: {
        branchId: data.branchId, employeeId: targetEmployeeId,
        operationReference: crypto.randomUUID(), reason: 'Actual performer for remaining units',
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reassignedAt: new Date('2026-08-03T12:05:00.000Z'),
      assertEmployee: async () => ({
        id: targetEmployeeId, employeeCode: data.employeeCode + 2,
        fullName: `Partial target ${data.marker}`, branchId: data.branchId,
      }),
    });

    expect(reassigned.status).toBe('partially_refunded');
    expect(await database.select().from(commissionLedgerEntries).where(
      eq(commissionLedgerEntries.invoiceLineId, completed.lines[0]!.id),
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: data.employeeId, entryType: 'earned', amount: '150.00' }),
      expect.objectContaining({ employeeId: data.employeeId, entryType: 'reversal', amount: '-30.00' }),
      expect.objectContaining({ employeeId: data.employeeId, entryType: 'reassignment_out', baseAmount: '800.00', amount: '-120.00' }),
      expect.objectContaining({ employeeId: targetEmployeeId, entryType: 'reassignment_in', baseAmount: '800.00', amount: '120.00' }),
    ]));
    expect(await database.select().from(erpCommissionPayrollInputs).where(
      eq(erpCommissionPayrollInputs.payrollMonth, '2026-08-01'),
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: data.employeeId, amount: '0.00' }),
      expect.objectContaining({ employeeId: targetEmployeeId, amount: '120.00' }),
    ]));
  });

  it('rolls back reassignment when either employee payroll is finalized', async () => {
    const data = await fixture();
    const targetEmployeeId = Number((await database.insert(employees).values({
      employeeCode: data.employeeCode + 2,
      fullName: `Locked target ${data.marker}`,
      personalPhone: `010${String(Number(data.clientPhone.slice(3)) + 2).padStart(8, '0')}`,
      whatsappPhone: `011${String(Number(data.clientPhone.slice(3)) + 2).padStart(8, '0')}`,
      pinHash: 'unused', age: 30, address: 'Cairo', branchId: data.branchId,
      shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00',
      createdAt: data.at, updatedAt: data.at,
    }))[0].insertId);
    const repository = createDrizzleSaleRepository(
      database, createErpAuditCapability(), createErpPayrollCapability(database),
    );
    const completed = await repository.complete(operation(data, crypto.randomUUID()));
    const finalizedAt = new Date('2026-09-01T08:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId: targetEmployeeId, payrollMonth: '2026-08-01',
      baseSalary: '5000.00', proratedBase: '5000.00', overtimeAmount: '0.00',
      bonusAmount: '0.00', commissionAmount: '0.00', attendanceDeductionAmount: '0.00',
      manualDeductionAmount: '0.00', commissionDeductionAmount: '0.00', advanceAmount: '0.00',
      priorNegativeCarry: '0.00', netSalary: '5000.00', eligibleWorkdays: 31,
      fullMonthWorkdays: 31, requiredMinutes: 14880, overtimeMinutes: 0, shortageMinutes: 0,
      finalizedAt, createdAt: finalizedAt, updatedAt: finalizedAt,
    });

    await expect(repository.reassignLine({
      invoiceId: completed.id, invoiceLineId: completed.lines[0]!.id,
      input: {
        branchId: data.branchId, employeeId: targetEmployeeId,
        operationReference: crypto.randomUUID(), reason: 'Must be blocked',
      },
      actingAccountId: data.adminAccountId, actingAccountRole: 'admin',
      reassignedAt: new Date('2026-08-03T12:00:00.000Z'),
      assertEmployee: async () => ({
        id: targetEmployeeId, employeeCode: data.employeeCode + 2,
        fullName: `Locked target ${data.marker}`, branchId: data.branchId,
      }),
    })).rejects.toMatchObject({ code: 'REASSIGN_PAYROLL_FINALIZED' });
    expect(await database.select().from(invoiceLineReassignments).where(
      eq(invoiceLineReassignments.invoiceLineId, completed.lines[0]!.id),
    )).toHaveLength(0);
  });
});
