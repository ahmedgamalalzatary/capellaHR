import { createDatabase } from '@capella/database';
import {
  attendanceDailyRecords,
  auditEvents,
  authSessions,
  branches,
  deviceHistory,
  devicePairingRequests,
  devices,
  employeeBranchAssignments,
  employeeCodeSequence,
  employeeImages,
  employeePhoneReservations,
  employees,
} from '@capella/database/schema';
import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  calendarDateInTimeZone,
  createWeeklyDayOffModule,
} from '../../src/modules/weekly-day-off/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const fixedNow = new Date('2026-07-18T09:00:00.000Z');
const isFinanciallyUnlocked = () => Promise.resolve(false);

if (process.env.NODE_ENV === 'typecheck') {
  // @ts-expect-error A financial-lock guard is mandatory at module construction.
  createWeeklyDayOffModule(database, { now: () => fixedNow });
}

const createBranch = async (name: string) => {
  const result = await database.insert(branches).values({
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
  });
  return Number(result[0].insertId);
};

const createEmployee = async (
  branchId: number,
  employeeCode: number,
  name: string,
  deletedAt: Date | null = null,
) => {
  const phone = `010${String(employeeCode).padStart(8, '0')}`;
  const result = await database.insert(employees).values({
    employeeCode,
    fullName: name,
    personalPhone: phone,
    whatsappPhone: phone,
    pinHash: 'hash',
    credentialVersion: 1,
    age: 30,
    address: 'القاهرة',
    branchId,
    shiftDurationMinutes: 600,
    monthlyBaseSalary: '5000.00',
    deletedAt,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  const employeeId = Number(result[0].insertId);
  await database.insert(employeeBranchAssignments).values({ employeeId, branchId, effectiveFrom: fixedNow, createdAt: fixedNow });
  return employeeId;
};

const createAbsence = async (
  employeeId: number,
  attendanceDate: string,
  absenceRequiredMinutes = 600,
) => {
  const [employee] = await database.select({ branchId: employees.branchId })
    .from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee) throw new Error('Employee fixture not found');
  const result = await database.insert(attendanceDailyRecords).values({
    employeeId,
    branchId: employee.branchId,
    attendanceDate,
    status: 'absence',
    absenceRequiredMinutes,
    dayOffConvertedAt: null,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  return Number(result[0].insertId);
};

beforeEach(async () => {
  await database.delete(auditEvents);
  await database.delete(attendanceDailyRecords);
  await database.delete(deviceHistory);
  await database.delete(devices);
  await database.delete(devicePairingRequests);
  await database.delete(authSessions);
  await database.delete(employeeImages);
  await database.delete(employeePhoneReservations);
  await database.delete(employeeBranchAssignments);
  await database.delete(employees);
  await database.delete(employeeCodeSequence);
  await database.delete(branches);
});

describe('MySQL-backed weekly day off', () => {
  it('keeps a historical daily record under its original branch after reassignment', async () => {
    const oldBranch = await createBranch('Old branch');
    const newBranch = await createBranch('New branch');
    const employeeId = await createEmployee(oldBranch, 1, 'Employee');
    await createAbsence(employeeId, '2026-07-10');
    const reassignedAt = new Date(fixedNow.getTime() + 60_000);
    await database.update(employeeBranchAssignments).set({ effectiveTo: reassignedAt })
      .where(and(eq(employeeBranchAssignments.employeeId, employeeId), eq(employeeBranchAssignments.branchId, oldBranch)));
    await database.insert(employeeBranchAssignments).values({ employeeId, branchId: newBranch, effectiveFrom: reassignedAt, createdAt: reassignedAt });
    await database.update(employees).set({ branchId: newBranch, updatedAt: reassignedAt }).where(eq(employees.id, employeeId));
    const module = createWeeklyDayOffModule(database, { now: () => reassignedAt, isFinanciallyLocked: isFinanciallyUnlocked });

    await expect(module.service.list({ branchId: oldBranch, page: 1, pageSize: 20 }))
      .resolves.toMatchObject({ total: 1, items: [{ employeeId, branchId: oldBranch }] });
    await expect(module.service.list({ branchId: newBranch, page: 1, pageSize: 20 }))
      .resolves.toMatchObject({ total: 0, items: [] });
  });
  it('lists active employee records with literal search and all filters', async () => {
    const cairo = await createBranch('القاهرة');
    const giza = await createBranch('الجيزة');
    const ahmed = await createEmployee(cairo, 1, 'أحمد علي');
    const mona = await createEmployee(giza, 2, 'منى حسن');
    const deleted = await createEmployee(cairo, 3, 'موظف محذوف', fixedNow);
    await createAbsence(ahmed, '2026-07-10');
    await createAbsence(mona, '2026-07-11');
    await createAbsence(deleted, '2026-07-12');
    const module = createWeeklyDayOffModule(database, {
      isFinanciallyLocked: isFinanciallyUnlocked,
      now: () => fixedNow,
    });

    const result = await module.service.list({
      search: 'منى',
      branchId: giza,
      employeeId: mona,
      status: 'absence',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      page: 1,
      pageSize: 20,
    });

    expect(result).toMatchObject({
      total: 1,
      items: [{ employeeCode: 2, employeeName: 'منى حسن', requiredMinutes: 600 }],
    });
    await expect(module.service.list({
      search: '%', page: 1, pageSize: 20,
    })).resolves.toMatchObject({ total: 0, items: [] });
    await expect(module.service.list({
      page: 1, pageSize: 20,
    })).resolves.toMatchObject({ total: 2 });
  });

  it('converts and reverts while preserving the exact absence duration snapshot', async () => {
    const branchId = await createBranch('القاهرة');
    const employeeId = await createEmployee(branchId, 1, 'أحمد علي');
    const recordId = await createAbsence(employeeId, '2026-07-10', 437);
    const module = createWeeklyDayOffModule(database, {
      isFinanciallyLocked: isFinanciallyUnlocked,
      now: () => fixedNow,
      timeZone: 'Africa/Cairo',
    });

    await expect(module.service.convert(recordId)).resolves.toMatchObject({
      status: 'weekly_day_off',
      absenceRequiredMinutes: 437,
      requiredMinutes: 0,
      dayOffConvertedAt: fixedNow,
    });
    await expect(module.service.revert(recordId)).resolves.toMatchObject({
      status: 'absence',
      absenceRequiredMinutes: 437,
      requiredMinutes: 437,
      dayOffConvertedAt: null,
    });
    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'weekly-day-off')).orderBy(asc(auditEvents.id));
    expect(events.map(({ action }) => action)).toEqual(['convert', 'revert']);
    expect(events[0]).toMatchObject({
      entityType: 'attendance_daily_record', entityId: String(recordId),
      beforeState: expect.objectContaining({ status: 'absence' }),
      afterState: expect.objectContaining({ status: 'weekly_day_off' }),
    });
  });

  it('rejects current and future Cairo dates', async () => {
    const branchId = await createBranch('القاهرة');
    const employeeId = await createEmployee(branchId, 1, 'أحمد علي');
    const current = await createAbsence(employeeId, '2026-07-18');
    const future = await createAbsence(employeeId, '2026-07-19');
    const module = createWeeklyDayOffModule(database, {
      isFinanciallyLocked: isFinanciallyUnlocked,
      now: () => fixedNow,
      timeZone: 'Africa/Cairo',
    });

    await expect(module.service.convert(current)).rejects.toMatchObject({
      code: 'WEEKLY_DAY_OFF_DATE_NOT_PAST',
    });
    await expect(module.service.convert(future)).rejects.toMatchObject({
      code: 'WEEKLY_DAY_OFF_DATE_NOT_PAST',
    });
  });

  it('requires seven calendar days in either direction and allows exactly seven', async () => {
    const branchId = await createBranch('القاهرة');
    const employeeId = await createEmployee(branchId, 1, 'أحمد علي');
    const first = await createAbsence(employeeId, '2026-07-01');
    const sixDaysLater = await createAbsence(employeeId, '2026-07-07');
    const sevenDaysLater = await createAbsence(employeeId, '2026-07-08');
    const sixDaysEarlier = await createAbsence(employeeId, '2026-06-25');
    const module = createWeeklyDayOffModule(database, {
      isFinanciallyLocked: isFinanciallyUnlocked,
      now: () => fixedNow,
    });

    await module.service.convert(first);
    await expect(module.service.convert(sixDaysLater)).rejects.toMatchObject({
      code: 'WEEKLY_DAY_OFF_SPACING_CONFLICT',
    });
    await expect(module.service.convert(sixDaysEarlier)).rejects.toMatchObject({
      code: 'WEEKLY_DAY_OFF_SPACING_CONFLICT',
    });
    await expect(module.service.convert(sevenDaysLater)).resolves.toMatchObject({
      status: 'weekly_day_off',
    });
  });

  it('serializes concurrent conversions so the spacing rule cannot be bypassed', async () => {
    const branchId = await createBranch('القاهرة');
    const employeeId = await createEmployee(branchId, 1, 'أحمد علي');
    const first = await createAbsence(employeeId, '2026-07-01');
    const second = await createAbsence(employeeId, '2026-07-04');
    const module = createWeeklyDayOffModule(database, {
      isFinanciallyLocked: isFinanciallyUnlocked,
      now: () => fixedNow,
    });

    const results = await Promise.allSettled([
      module.service.convert(first),
      module.service.convert(second),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(module.service.list({
      employeeId, status: 'weekly_day_off', page: 1, pageSize: 20,
    })).resolves.toMatchObject({ total: 1 });
  });

  it('rolls back transitions when payroll has financially locked the date', async () => {
    const branchId = await createBranch('القاهرة');
    const employeeId = await createEmployee(branchId, 1, 'أحمد علي');
    const recordId = await createAbsence(employeeId, '2026-07-10');
    const module = createWeeklyDayOffModule(database, {
      now: () => fixedNow,
      isFinanciallyLocked: async (lockedEmployeeId, date, transaction) => {
        expect(lockedEmployeeId).toBe(employeeId);
        expect(date).toBe('2026-07-10');
        expect(transaction).toBeDefined();
        return true;
      },
    });

    await expect(module.service.convert(recordId)).rejects.toMatchObject({
      code: 'WEEKLY_DAY_OFF_FINANCIALLY_LOCKED',
    });
    expect((await database.select().from(attendanceDailyRecords)
      .where(eq(attendanceDailyRecords.id, recordId)))[0]).toMatchObject({
      status: 'absence',
      dayOffConvertedAt: null,
    });
  });

  it('hides records belonging to soft-deleted employees', async () => {
    const branchId = await createBranch('القاهرة');
    const employeeId = await createEmployee(branchId, 1, 'موظف محذوف', fixedNow);
    const recordId = await createAbsence(employeeId, '2026-07-10');
    const module = createWeeklyDayOffModule(database, {
      isFinanciallyLocked: isFinanciallyUnlocked,
      now: () => fixedNow,
    });

    await expect(module.service.get(recordId)).rejects.toMatchObject({
      code: 'WEEKLY_DAY_RECORD_NOT_FOUND',
    });
    await expect(module.service.convert(recordId)).rejects.toMatchObject({
      code: 'WEEKLY_DAY_RECORD_NOT_FOUND',
    });
  });

  it('derives the business date with Cairo daylight-saving boundaries', () => {
    expect(calendarDateInTimeZone(
      new Date('2026-07-18T20:59:59.999Z'),
      'Africa/Cairo',
    )).toBe('2026-07-18');
    expect(calendarDateInTimeZone(
      new Date('2026-07-18T21:00:00.000Z'),
      'Africa/Cairo',
    )).toBe('2026-07-19');
  });
});
