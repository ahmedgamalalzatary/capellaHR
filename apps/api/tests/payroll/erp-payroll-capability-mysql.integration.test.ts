import {
  branches,
  employees,
  erpCommissionPayrollInputs,
  erpPostPayrollDeductions,
  payrollMonths,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDrizzlePayrollRepository,
  createErpPayrollCapability,
  createPayrollModule,
} from '../../src/modules/payroll/index.js';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();

let employeeId: number;

beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  const at = new Date('2026-08-01T09:00:00.000Z');
  const branchId = Number((await database.insert(branches).values({
    name: 'ERP 17', nameNormalized: 'erp 17', location: 'Cairo',
    latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 100,
    createdAt: at, updatedAt: at,
  }))[0].insertId);
  employeeId = Number((await database.insert(employees).values({
    employeeCode: 1_710_000_001, fullName: 'Employee ERP 17',
    personalPhone: '01017100001', whatsappPhone: '01117100001', pinHash: 'unused',
    age: 30, address: 'Cairo', branchId, shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00', createdAt: at, updatedAt: at,
  }))[0].insertId);
}, 120_000);

afterAll(async () => {
  await closeMysqlIntegrationDatabase(database);
}, 30_000);

describe('ERP payroll public capability', () => {
  it('publishes the capability from the payroll module composition surface', () => {
    const module = createPayrollModule(database);
    expect(typeof module.erp.lockCommissionEmployee).toBe('function');
    expect(typeof module.erp.projectCommission).toBe('function');
    expect(typeof module.erp.recordPostPayrollDeduction).toBe('function');
  });

  it('records, repeats, and updates one deterministic live commission projection', async () => {
    const capability = createErpPayrollCapability(database, {
      now: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    const input = {
      employeeId,
      payrollMonth: '2026-08',
      amount: '125.00',
      reference: `erp-commission:2026-08:${employeeId}`,
    };

    await expect(capability.projectCommission(input)).resolves.toBe('recorded');
    await expect(capability.projectCommission(input)).resolves.toBe('already_recorded');
    await expect(capability.projectCommission({ ...input, amount: '175.00' })).resolves.toBe('updated');

    const rows = await database.select().from(erpCommissionPayrollInputs).where(and(
      eq(erpCommissionPayrollInputs.employeeId, employeeId),
      eq(erpCommissionPayrollInputs.payrollMonth, '2026-08-01'),
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: '175.00', reference: input.reference });
  });

  it('calculates a projection only after acquiring the employee lock', async () => {
    const capability = createErpPayrollCapability(database);
    let calculated = false;

    await expect(capability.projectCommission({
      employeeId,
      payrollMonth: '2026-09',
      calculateAmount: async () => {
        calculated = true;
        return '45.00';
      },
      reference: `erp-commission:2026-09:${employeeId}`,
    })).resolves.toBe('recorded');

    expect(calculated).toBe(true);
  });

  it('rejects commission money outside the DECIMAL(14,2) database range', async () => {
    const capability = createErpPayrollCapability(database);
    await expect(capability.projectCommission({
      employeeId,
      payrollMonth: '2026-08',
      amount: '1000000000000.00',
      reference: `erp-commission:2026-08:${employeeId}`,
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses to change a finalized payroll and records a Cairo-month deduction idempotently', async () => {
    const finalizedAt = new Date('2026-09-02T09:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId, payrollMonth: '2026-07-01', baseSalary: '5000.00', proratedBase: '5000.00',
      overtimeAmount: '0.00', bonusAmount: '0.00', commissionAmount: '100.00',
      attendanceDeductionAmount: '0.00', manualDeductionAmount: '0.00',
      commissionDeductionAmount: '0.00', advanceAmount: '0.00', priorNegativeCarry: '0.00',
      netSalary: '5100.00', eligibleWorkdays: 31, fullMonthWorkdays: 31,
      requiredMinutes: 14880, overtimeMinutes: 0, shortageMinutes: 0,
      finalizedAt, createdAt: finalizedAt, updatedAt: finalizedAt,
    });
    const capability = createErpPayrollCapability(database);
    await expect(capability.projectCommission({
      employeeId, payrollMonth: '2026-07', amount: '80.00',
      reference: `erp-commission:2026-07:${employeeId}`,
    })).resolves.toBe('payroll_finalized');

    const deduction = {
      employeeId,
      occurredAt: new Date('2026-07-31T22:30:00.000Z'),
      amount: '20.00',
      reference: `erp-commission-reversal:77:${employeeId}`,
    };
    await expect(capability.recordPostPayrollDeduction(deduction)).resolves.toBe('recorded');
    await expect(capability.recordPostPayrollDeduction(deduction)).resolves.toBe('already_recorded');
    const rows = await database.select().from(erpPostPayrollDeductions)
      .where(eq(erpPostPayrollDeductions.reference, deduction.reference));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ payrollMonth: '2026-08-01', amount: '20.00' });
  });

  it('distinguishes a migrated finalized payroll that never snapshotted commission', async () => {
    const finalizedAt = new Date('2026-09-02T09:00:00.000Z');
    await database.insert(payrollMonths).values({
      employeeId, payrollMonth: '2026-06-01', baseSalary: '5000.00', proratedBase: '5000.00',
      overtimeAmount: '0.00', bonusAmount: '0.00', commissionAmount: '0.00',
      attendanceDeductionAmount: '0.00', manualDeductionAmount: '0.00',
      commissionDeductionAmount: '0.00', advanceAmount: '0.00', priorNegativeCarry: '0.00',
      netSalary: '5000.00', eligibleWorkdays: 30, fullMonthWorkdays: 30,
      requiredMinutes: 14400, overtimeMinutes: 0, shortageMinutes: 0,
      finalizedAt, createdAt: finalizedAt, updatedAt: finalizedAt,
    });

    await expect(createErpPayrollCapability(database).projectCommission({
      employeeId, payrollMonth: '2026-06', amount: '80.00',
      reference: `erp-commission:2026-06:${employeeId}`,
    })).resolves.toBe('payroll_finalized_without_commission');
  });

  it('includes live commission inputs and ERP deductions in open payroll', async () => {
    const capability = createErpPayrollCapability(database);
    await capability.projectCommission({
      employeeId, payrollMonth: '2026-08', amount: '175.00',
      reference: `erp-commission:2026-08:${employeeId}`,
    });
    await capability.recordPostPayrollDeduction({
      employeeId, occurredAt: new Date('2026-07-31T22:30:00.000Z'), amount: '20.00',
      reference: `erp-commission-reversal:77:${employeeId}`,
    });
    const repository = createDrizzlePayrollRepository(database, {
      now: () => new Date('2026-09-01T09:00:00.000Z'),
    });
    const result = await repository.preview(employeeId, '2026-08', {
      readPayrollFacts: async () => ({
        kind: 'ready',
        facts: {
          fullMonthWorkdays: 0, eligibleWorkdays: 0, requiredMinutes: 0,
          overtimeMinutes: 0, shortageMinutes: 0,
        },
      }),
    });

    expect(result).toMatchObject({
      kind: 'success',
      payroll: {
        commissionAmount: '175.00',
        commissionDeductionAmount: '20.00',
        netSalary: '155.00',
      },
    });
  });
});
