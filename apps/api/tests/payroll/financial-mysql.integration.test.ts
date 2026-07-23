import { createDatabase } from '@capella/database';
import {
  advanceInstallments,
  advances,
  auditEvents,
  attendanceDailyRecords,
  authSessions,
  bonuses,
  branches,
  deductions,
  deviceHistory,
  devicePairingRequests,
  devices,
  employeeCodeSequence,
  employeeImages,
  employeePhoneReservations,
  employeeSalaryPeriods,
  employees,
  financialAuditEvents,
  payrollMonths,
} from '@capella/database/schema';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAdvanceModule } from '../../src/modules/advances/index.js';
import { createBonusModule } from '../../src/modules/bonuses/index.js';
import { createDeductionModule } from '../../src/modules/deductions/index.js';
import { createDrizzleEmployeeRepository, createEmployeesModule } from '../../src/modules/employees/index.js';
import { createPayrollModule, type PayrollAttendanceGateway } from '../../src/modules/payroll/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const fixedNow = new Date('2026-07-18T09:00:00.000Z');
const attendance: PayrollAttendanceGateway = {
  readPayrollFacts: async () => ({
    kind: 'ready',
    facts: {
      fullMonthWorkdays: 30,
      eligibleWorkdays: 30,
      requiredMinutes: 18_000,
      overtimeMinutes: 60,
      shortageMinutes: 30,
    },
  }),
};

const clear = async () => {
  await database.delete(auditEvents);
  await database.delete(financialAuditEvents);
  await database.delete(advanceInstallments);
  await database.delete(advances);
  await database.delete(bonuses);
  await database.delete(deductions);
  await database.delete(payrollMonths);
  await database.delete(employeeSalaryPeriods);
  await database.delete(attendanceDailyRecords);
  await database.delete(deviceHistory);
  await database.delete(devices);
  await database.delete(devicePairingRequests);
  await database.delete(authSessions);
  await database.delete(employeeImages);
  await database.delete(employeePhoneReservations);
  await database.delete(employees);
  await database.delete(employeeCodeSequence);
  await database.delete(branches);
};
beforeEach(clear);
afterAll(clear);

const createBranch = async (name = 'القاهرة') => Number((await database.insert(branches).values({
  name,
  nameNormalized: name.toLowerCase().padEnd(64, '0').slice(0, 64),
  location: 'القاهرة',
  latitude: 30,
  longitude: 31,
  gpsAccuracyMeters: 5,
  attendanceRadiusMeters: 50,
  hasEverBeenReferenced: true,
  createdAt: fixedNow,
  updatedAt: fixedNow,
}))[0].insertId);

const createEmployee = async (
  branchId: number,
  code: number,
  createdAt = new Date('2026-06-01T09:00:00.000Z'),
) => Number((await database.insert(employees).values({
  employeeCode: code,
  fullName: `موظف ${code}`,
  personalPhone: `010${String(code).padStart(8, '0')}`,
  whatsappPhone: `010${String(code).padStart(8, '0')}`,
  pinHash: 'hash',
  credentialVersion: 1,
  age: 30,
  address: 'القاهرة',
  branchId,
  shiftDurationMinutes: 600,
  monthlyBaseSalary: '6000.00',
  createdAt,
  updatedAt: createdAt,
}))[0].insertId);

describe('MySQL-backed salary domain', () => {
  it('records effective salary periods while applying a change to the whole current month', async () => {
    const branchId = await createBranch();
    const employeeId = await createEmployee(branchId, 1, new Date('2026-05-10T09:00:00.000Z'));
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance });

    await expect(payroll.service.updateBaseSalary(employeeId, { amount: '7500.00' }))
      .resolves.toMatchObject({ employeeId, amount: '7500.00' });
    await expect(payroll.service.getBaseSalary(employeeId))
      .resolves.toMatchObject({ amount: '7500.00' });

    const periods = await database.select().from(employeeSalaryPeriods)
      .where(eq(employeeSalaryPeriods.employeeId, employeeId))
      .orderBy(asc(employeeSalaryPeriods.effectiveMonth));
    expect(periods.map(({ effectiveMonth, baseSalary }) => ({ effectiveMonth, baseSalary }))).toEqual([
      { effectiveMonth: '2026-05-01', baseSalary: '6000.00' },
      { effectiveMonth: '2026-07-01', baseSalary: '7500.00' },
    ]);
  });

  it('enforces bonus and deduction month, finalization, and employee-deletion locks', async () => {
    const branchId = await createBranch();
    const employeeId = await createEmployee(branchId, 1);
    const bonusModule = createBonusModule(database, { now: () => fixedNow });
    const deductionModule = createDeductionModule(database, { now: () => fixedNow });

    const bonus = await bonusModule.service.create({ employeeId, amount: '100.00', payrollMonth: '2026-07', reason: 'سبب' });
    const deduction = await deductionModule.service.create({ employeeId, amount: '25.00', payrollMonth: '2026-06' });
    await expect(bonusModule.service.create({ employeeId, amount: '1.00', payrollMonth: '2026-05', reason: 'سبب' }))
      .rejects.toMatchObject({ code: 'BONUS_MONTH_NOT_ELIGIBLE' });
    await expect(bonusModule.service.create({ employeeId, amount: '1.00', payrollMonth: '2026-08', reason: 'سبب' }))
      .rejects.toMatchObject({ code: 'BONUS_FUTURE_MONTH' });

    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance });
    await payroll.service.finalize(employeeId, '2026-06');
    await expect(deductionModule.service.update(deduction.id, { amount: '30.00' }))
      .rejects.toMatchObject({ code: 'DEDUCTION_PAYROLL_FINALIZED' });

    await database.update(employees).set({ deletedAt: fixedNow }).where(eq(employees.id, employeeId));
    await expect(bonusModule.service.get(bonus.id)).resolves.toMatchObject({ employeeDeletedAt: fixedNow });
    await expect(bonusModule.service.update(bonus.id, { amount: '110.00', reason: 'سبب محدث' }))
      .rejects.toMatchObject({ code: 'BONUS_EMPLOYEE_DELETED' });
    await expect(bonusModule.service.create({ employeeId, amount: '1.00', payrollMonth: '2026-07', reason: 'سبب' }))
      .rejects.toMatchObject({ code: 'BONUS_EMPLOYEE_DELETED' });
  });

  it('generates exact consecutive installments, regenerates atomically, and locks the whole advance', async () => {
    const branchId = await createBranch();
    const employeeId = await createEmployee(branchId, 1);
    const advanceModule = createAdvanceModule(database, { now: () => fixedNow });
    await expect(advanceModule.service.create({
      employeeId, amount: '1.00', installmentCount: 1, startMonth: '2026-05',
    })).rejects.toMatchObject({ code: 'ADVANCE_MONTH_NOT_ELIGIBLE' });
    const created = await advanceModule.service.create({
      employeeId, amount: '100.00', installmentCount: 3, startMonth: '2026-07',
    });
    expect(created.installments.map(({ payrollMonth, amount }) => ({ payrollMonth, amount }))).toEqual([
      { payrollMonth: '2026-07', amount: '33.33' },
      { payrollMonth: '2026-08', amount: '33.33' },
      { payrollMonth: '2026-09', amount: '33.34' },
    ]);

    const regenerated = await advanceModule.service.update(created.id, {
      amount: '80.00', installmentCount: 2, startMonth: '2026-06',
    });
    expect(regenerated.installments.map(({ payrollMonth, amount }) => ({ payrollMonth, amount }))).toEqual([
      { payrollMonth: '2026-06', amount: '40.00' },
      { payrollMonth: '2026-07', amount: '40.00' },
    ]);

    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance });
    await payroll.service.finalize(employeeId, '2026-06');
    await expect(advanceModule.service.update(created.id, { amount: '90.00' }))
      .rejects.toMatchObject({ code: 'ADVANCE_PAYROLL_FINALIZED' });
    await expect(advanceModule.service.remove(created.id))
      .rejects.toMatchObject({ code: 'ADVANCE_PAYROLL_FINALIZED' });
  });

  it('rejects create and update when any generated installment month is finalized', async () => {
    const branchId = await createBranch();
    const employeeId = await createEmployee(branchId, 1, new Date('2026-05-01T09:00:00.000Z'));
    const advanceModule = createAdvanceModule(database, { now: () => fixedNow });
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance });
    await payroll.service.finalize(employeeId, '2026-05');
    await payroll.service.finalize(employeeId, '2026-06');
    await database.delete(payrollMonths).where(and(
      eq(payrollMonths.employeeId, employeeId),
      eq(payrollMonths.payrollMonth, '2026-05-01'),
    ));

    await expect(advanceModule.service.create({
      employeeId, amount: '90.00', installmentCount: 2, startMonth: '2026-05',
    })).rejects.toMatchObject({ code: 'ADVANCE_PAYROLL_FINALIZED' });

    const editable = await advanceModule.service.create({
      employeeId, amount: '90.00', installmentCount: 1, startMonth: '2026-07',
    });
    await expect(advanceModule.service.update(editable.id, {
      installmentCount: 2, startMonth: '2026-06',
    })).rejects.toMatchObject({ code: 'ADVANCE_PAYROLL_FINALIZED' });
    await expect(advanceModule.service.get(editable.id)).resolves.toMatchObject({
      installmentCount: 1,
      installments: [{ payrollMonth: '2026-07', amount: '90.00' }],
    });
  });

  it('accelerates the remaining advance balance inside employee deletion', async () => {
    const branchId = await createBranch();
    const employeeId = await createEmployee(branchId, 1);
    const advanceModule = createAdvanceModule(database, { now: () => fixedNow });
    const created = await advanceModule.service.create({
      employeeId, amount: '100.00', installmentCount: 3, startMonth: '2026-06',
    });
    await createPayrollModule(database, { now: () => fixedNow, attendance }).service
      .finalize(employeeId, '2026-06');
    const employeeModule = createEmployeesModule(
      database,
      16_777_216,
      { hasOpenSession: async () => false },
      createDrizzleEmployeeRepository(database, () => fixedNow),
      undefined,
      advanceModule.lifecycle,
    );

    await employeeModule.service.remove(employeeId);

    const stored = await advanceModule.service.get(created.id);
    expect(stored.employeeDeletedAt).toEqual(fixedNow);
    expect(stored.installments.map(({ payrollMonth, amount }) => ({ payrollMonth, amount }))).toEqual([
      { payrollMonth: '2026-06', amount: '33.33' },
      { payrollMonth: '2026-07', amount: '66.67' },
    ]);
  });

  it('uses the employee deletion instant for the final accelerated payroll month', async () => {
    const branchId = await createBranch();
    const employeeId = await createEmployee(branchId, 1);
    const afterCairoMonthBoundary = new Date('2026-07-31T21:01:00.000Z');
    const deletionInstant = new Date('2026-07-31T20:59:00.000Z');
    const advanceModule = createAdvanceModule(database, { now: () => afterCairoMonthBoundary });
    const created = await advanceModule.service.create({
      employeeId, amount: '100.00', installmentCount: 2, startMonth: '2026-07',
    });
    const employeeModule = createEmployeesModule(
      database,
      16_777_216,
      { hasOpenSession: async () => false },
      createDrizzleEmployeeRepository(database, () => deletionInstant),
      undefined,
      advanceModule.lifecycle,
    );

    await employeeModule.service.remove(employeeId);

    await expect(advanceModule.service.get(created.id)).resolves.toMatchObject({
      installments: [{ payrollMonth: '2026-07', amount: '100.00' }],
      employeeDeletedAt: deletionInstant,
    });
  });

  it('accelerates deletion balance into the next month when the deletion month is finalized', async () => {
    const branchId = await createBranch();
    const employeeId = await createEmployee(branchId, 1, new Date('2026-06-01T09:00:00.000Z'));
    const augustNow = new Date('2026-08-18T09:00:00.000Z');
    const deletionInstant = new Date('2026-07-31T12:00:00.000Z');
    const advanceModule = createAdvanceModule(database, { now: () => augustNow });
    const created = await advanceModule.service.create({
      employeeId, amount: '100.00', installmentCount: 2, startMonth: '2026-08',
    });
    const payroll = createPayrollModule(database, { now: () => augustNow, attendance });
    await payroll.service.finalize(employeeId, '2026-06');
    await payroll.service.finalize(employeeId, '2026-07');
    const employeeModule = createEmployeesModule(
      database,
      16_777_216,
      { hasOpenSession: async () => false },
      createDrizzleEmployeeRepository(database, () => deletionInstant),
      undefined,
      advanceModule.lifecycle,
    );

    await employeeModule.service.remove(employeeId);

    await expect(advanceModule.service.get(created.id)).resolves.toMatchObject({
      installments: [{ payrollMonth: '2026-08', amount: '100.00' }],
      employeeDeletedAt: deletionInstant,
    });
  });

  it('rejects an installment whose employee does not own its advance', async () => {
    const branchId = await createBranch();
    const ownerId = await createEmployee(branchId, 1);
    const otherEmployeeId = await createEmployee(branchId, 2);
    const created = await createAdvanceModule(database, { now: () => fixedNow }).service.create({
      employeeId: ownerId, amount: '10.00', installmentCount: 1, startMonth: '2026-07',
    });

    await expect(database.insert(advanceInstallments).values({
      advanceId: created.id,
      employeeId: otherEmployeeId,
      ordinal: 2,
      payrollMonth: '2026-08-01',
      amount: '1.00',
      createdAt: fixedNow,
    })).rejects.toThrow();
  });

  it('calculates and permanently finalizes payroll with all financial inputs', async () => {
    const branchId = await createBranch();
    const employeeId = await createEmployee(branchId, 1);
    await createBonusModule(database, { now: () => fixedNow }).service.create({
      employeeId, amount: '100.00', payrollMonth: '2026-06', reason: 'سبب',
    });
    await createDeductionModule(database, { now: () => fixedNow }).service.create({
      employeeId, amount: '50.00', payrollMonth: '2026-06',
    });
    await createAdvanceModule(database, { now: () => fixedNow }).service.create({
      employeeId, amount: '200.00', installmentCount: 1, startMonth: '2026-06',
    });
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance });

    await expect(payroll.service.preview(employeeId, '2026-05'))
      .rejects.toMatchObject({ code: 'PAYROLL_MONTH_NOT_ELIGIBLE' });
    await expect(payroll.service.preview(employeeId, '2026-06')).resolves.toMatchObject({
      status: 'open', bonusAmount: '100.00', manualDeductionAmount: '50.00', advanceAmount: '200.00',
    });
    await expect(payroll.service.finalize(employeeId, '2026-06')).resolves.toMatchObject({
      status: 'finalized', finalizedAt: fixedNow,
    });
    await expect(payroll.service.finalize(employeeId, '2026-06'))
      .rejects.toMatchObject({ code: 'PAYROLL_ALREADY_FINALIZED' });
    await expect(payroll.service.isFinanciallyLocked(employeeId, '2026-06-15')).resolves.toBe(true);
  });

  it('rejects newer months before older ones and keeps branch finalization atomic', async () => {
    const branchId = await createBranch();
    const first = await createEmployee(branchId, 1, new Date('2026-05-01T09:00:00.000Z'));
    const second = await createEmployee(branchId, 2, new Date('2026-05-01T09:00:00.000Z'));
    const blockedAttendance: PayrollAttendanceGateway = {
      readPayrollFacts: async (employeeId) => employeeId === second
        ? { kind: 'blocked', reasons: ['OPEN_SESSION'] }
        : attendance.readPayrollFacts(employeeId, '2026-05', {}, 'finalize'),
    };
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance });
    await expect(payroll.service.finalize(first, '2026-06'))
      .rejects.toMatchObject({ code: 'PAYROLL_CHRONOLOGY_CONFLICT' });

    const branchPayroll = createPayrollModule(database, { now: () => fixedNow, attendance: blockedAttendance });
    await expect(branchPayroll.service.finalizeBranch(branchId, '2026-05'))
      .rejects.toMatchObject({
        code: 'PAYROLL_BLOCKED', reasons: expect.arrayContaining([`${second}:OPEN_SESSION`]),
      });
    expect(await database.select().from(payrollMonths)).toHaveLength(0);
  });

  it('reports blocked payroll-list employees instead of dropping them from the page', async () => {
    const branchId = await createBranch();
    const first = await createEmployee(branchId, 1);
    const second = await createEmployee(branchId, 2);
    const blockedAttendance: PayrollAttendanceGateway = {
      readPayrollFacts: async (employeeId) => employeeId === second
        ? { kind: 'blocked', reasons: ['OPEN_SESSION'] }
        : attendance.readPayrollFacts(employeeId, '2026-06', {}, 'preview'),
    };
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance: blockedAttendance });

    await expect(payroll.service.list({ month: '2026-06', page: 1, pageSize: 20 }))
      .rejects.toMatchObject({
        code: 'PAYROLL_BLOCKED',
        reasons: [`${second}:OPEN_SESSION`],
      });
    expect(first).not.toBe(second);
  });

  it('evaluates employment months in Cairo for lists and branch finalization', async () => {
    const branchId = await createBranch();
    await createEmployee(branchId, 1, new Date('2026-05-31T21:30:00.000Z'));
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance });

    await expect(payroll.service.list({ month: '2026-05', page: 1, pageSize: 20 }))
      .resolves.toEqual({ items: [], total: 0 });
    await expect(payroll.service.finalizeBranch(branchId, '2026-05')).resolves.toEqual([]);
    expect(await database.select().from(payrollMonths)).toHaveLength(0);
  });

  it('collects every employee-scoped branch blocker before rolling back', async () => {
    const branchId = await createBranch();
    const chronologyEmployee = await createEmployee(branchId, 1, new Date('2026-05-01T09:00:00.000Z'));
    const attendanceEmployee = await createEmployee(branchId, 2, new Date('2026-06-01T09:00:00.000Z'));
    const blockedAttendance: PayrollAttendanceGateway = {
      readPayrollFacts: async (employeeId) => employeeId === attendanceEmployee
        ? { kind: 'blocked', reasons: ['DENIED_ATTEMPT'] }
        : attendance.readPayrollFacts(employeeId, '2026-06', {}, 'finalize'),
    };
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance: blockedAttendance });

    await expect(payroll.service.finalizeBranch(branchId, '2026-06')).rejects.toMatchObject({
      code: 'PAYROLL_BLOCKED',
      reasons: expect.arrayContaining([
        `${chronologyEmployee}:PAYROLL_CHRONOLOGY_CONFLICT`,
        `${attendanceEmployee}:DENIED_ATTEMPT`,
      ]),
    });
    expect(await database.select().from(payrollMonths)).toHaveLength(0);
  });

  it('fails closed when valid adjustment rows exceed snapshot decimal capacity', async () => {
    const branchId = await createBranch();
    const employeeId = await createEmployee(branchId, 1);
    await database.insert(bonuses).values(Array.from({ length: 101 }, () => ({
      employeeId,
      payrollMonth: '2026-06-01',
      amount: '9999999999.99',
      createdAt: fixedNow,
      updatedAt: fixedNow,
    })));
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance });

    await expect(payroll.service.finalize(employeeId, '2026-06')).rejects.toMatchObject({
      code: 'PAYROLL_BLOCKED',
      reasons: ['PAYROLL_AMOUNT_OUT_OF_RANGE'],
    });
    expect(await database.select().from(payrollMonths)).toHaveLength(0);
  });

  it('finalizes remaining branch employees idempotently when some are already finalized', async () => {
    const branchId = await createBranch();
    const first = await createEmployee(branchId, 1);
    const second = await createEmployee(branchId, 2);
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance });
    await payroll.service.finalize(first, '2026-06');

    await expect(payroll.service.finalizeBranch(branchId, '2026-06')).resolves.toHaveLength(2);
    await expect(payroll.service.finalizeBranch(branchId, '2026-06')).resolves.toHaveLength(2);
    const rows = await database.select().from(payrollMonths);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.employeeId).sort()).toEqual([first, second].sort());
  });

  it('serializes concurrent finalization into exactly one immutable snapshot', async () => {
    const branchId = await createBranch();
    const employeeId = await createEmployee(branchId, 1);
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance });

    const results = await Promise.allSettled([
      payroll.service.finalize(employeeId, '2026-06'),
      payroll.service.finalize(employeeId, '2026-06'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({ code: 'PAYROLL_ALREADY_FINALIZED' }),
    });
    expect(await database.select().from(payrollMonths)).toHaveLength(1);
  });

  it('writes immutable financial audit events for mutations', async () => {
    const branchId = await createBranch();
    const employeeId = await createEmployee(branchId, 1);
    const bonusesModule = createBonusModule(database, { now: () => fixedNow });
    const created = await bonusesModule.service.create({ employeeId, amount: '10.00', payrollMonth: '2026-07', reason: 'سبب' });
    await bonusesModule.service.update(created.id, { amount: '20.00', reason: 'سبب محدث' });
    await bonusesModule.service.remove(created.id);
    const events = await database.select().from(financialAuditEvents)
      .where(eq(financialAuditEvents.entityType, 'bonus')).orderBy(asc(financialAuditEvents.id));
    expect(events.map((event) => event.action)).toEqual(['create', 'update', 'delete']);
    expect(events[2]?.beforeState).toMatchObject({ amount: '20.00' });
    const general = await database.select().from(auditEvents)
      .where(eq(auditEvents.entityType, 'bonus')).orderBy(asc(auditEvents.id));
    expect(general.map((event) => event.action)).toEqual(['create', 'update', 'delete']);
    expect(general[1]).toMatchObject({
      module: 'bonuses',
      relatedIds: { employeeId: String(employeeId) },
      beforeState: expect.objectContaining({ amount: '10.00' }),
      afterState: expect.objectContaining({ amount: '20.00' }),
    });
  });
});
