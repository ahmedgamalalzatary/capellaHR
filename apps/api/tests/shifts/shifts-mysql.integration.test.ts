import { createDatabase } from '@capella/database';
import {
  attendanceDailyRecords,
  attendanceJobs,
  auditEvents,
  authSessions,
  branches,
  deviceAuthenticationChallenges,
  deviceHistory,
  devicePairingRequests,
  devices,
  employeeCodeSequence,
  employeeImages,
  employeePhoneReservations,
  employees,
} from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createShiftsModule } from '../../src/modules/shifts/index.js';
import { createDrizzleAttendanceRepository } from '../../src/modules/attendance/attendance-repository.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const shifts = createShiftsModule(database);

const now = new Date('2026-07-18T00:00:00.000Z');

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
    createdAt: now,
    updatedAt: now,
  });
  return Number(result[0].insertId);
};

const createEmployee = async (
  branchId: number,
  employeeCode: number,
  fullName: string,
  durationMinutes: number,
  deletedAt: Date | null = null,
) => {
  const phone = `010${String(employeeCode).padStart(8, '0')}`;
  const result = await database.insert(employees).values({
    employeeCode,
    fullName,
    personalPhone: phone,
    whatsappPhone: phone,
    pinHash: 'hash',
    credentialVersion: 1,
    age: 30,
    address: 'القاهرة',
    branchId,
    shiftDurationMinutes: durationMinutes,
    monthlyBaseSalary: '5000.00',
    deletedAt,
    createdAt: now,
    updatedAt: now,
  });
  return Number(result[0].insertId);
};

beforeEach(async () => {
  await database.delete(auditEvents);
  await database.delete(attendanceDailyRecords);
  await database.delete(attendanceJobs);
  await database.delete(deviceAuthenticationChallenges);
  await database.delete(deviceHistory);
  await database.delete(devices);
  await database.delete(devicePairingRequests);
  await database.delete(authSessions);
  await database.delete(employeeImages);
  await database.delete(employeePhoneReservations);
  await database.delete(employees);
  await database.delete(employeeCodeSequence);
  await database.delete(branches);
});

describe('MySQL-backed shifts', () => {
  it('lists active assignments with employee search, branch filter, and pagination totals', async () => {
    const cairo = await createBranch('القاهرة');
    const giza = await createBranch('الجيزة');
    await createEmployee(cairo, 1, 'أحمد علي', 600);
    await createEmployee(giza, 2, 'منى حسن', 480);
    await createEmployee(cairo, 3, 'موظف محذوف', 300, now);

    const byName = await shifts.service.list({ search: 'منى', page: 1, pageSize: 20 });
    const byCodeAndBranch = await shifts.service.list({
      search: '1', branchId: cairo, page: 1, pageSize: 1,
    });

    expect(byName).toMatchObject({ total: 1, items: [{ employeeCode: 2, branchName: 'الجيزة' }] });
    expect(byCodeAndBranch).toMatchObject({
      total: 1,
      items: [{ employeeCode: 1, employeeName: 'أحمد علي', durationMinutes: 600 }],
    });
    expect(await shifts.service.list({ search: '%', page: 1, pageSize: 20 })).toMatchObject({ total: 0, items: [] });
  });

  it('gets and atomically updates an active employee assignment', async () => {
    const branchId = await createBranch('القاهرة');
    const employeeId = await createEmployee(branchId, 1, 'أحمد علي', 600);

    await expect(shifts.service.getByEmployee(employeeId)).resolves.toMatchObject({
      employeeId,
      employeeCode: 1,
      durationMinutes: 600,
    });
    await expect(shifts.service.updateByEmployee(employeeId, {
      durationMinutes: 720,
    })).resolves.toMatchObject({ employeeId, durationMinutes: 720 });

    const stored = await database.select({ duration: employees.shiftDurationMinutes })
      .from(employees).where(eq(employees.id, employeeId));
    expect(stored[0]?.duration).toBe(720);
    const event = (await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'shifts')).limit(1))[0];
    expect(event).toMatchObject({
      action: 'update', entityType: 'shift_assignment', entityId: String(employeeId),
      beforeState: expect.objectContaining({ durationMinutes: 600 }),
      afterState: expect.objectContaining({ durationMinutes: 720 }),
    });
  });

  it('reads the required-duration snapshot inside the caller transaction', async () => {
    const branchId = await createBranch('القاهرة');
    const employeeId = await createEmployee(branchId, 1, 'أحمد علي', 600);

    const snapshot = await database.transaction((transaction) => (
      shifts.service.readRequiredDurationForCheckIn(employeeId, transaction)
    ));

    expect(snapshot).toBe(600);
  });

  it('can read a deleted employee duration only for historical Attendance validation', async () => {
    const branchId = await createBranch('Historical branch');
    const employeeId = await createEmployee(branchId, 1, 'Historical employee', 600, now);

    await expect(database.transaction((transaction) => (
      shifts.service.readRequiredDurationForCheckIn(employeeId, transaction)
    ))).rejects.toMatchObject({ code: 'SHIFT_ASSIGNMENT_NOT_FOUND' });
    await expect(database.transaction((transaction) => (
      shifts.service.readRequiredDurationForCheckIn(employeeId, transaction, true)
    ))).resolves.toBe(600);
  });

  it('treats deleted and unknown employees as missing assignments', async () => {
    const branchId = await createBranch('القاهرة');
    const deletedId = await createEmployee(branchId, 1, 'موظف محذوف', 600, now);

    await expect(shifts.service.getByEmployee(deletedId)).rejects.toMatchObject({
      code: 'SHIFT_ASSIGNMENT_NOT_FOUND',
    });
    await expect(shifts.service.updateByEmployee(deletedId, {
      durationMinutes: 480,
    })).rejects.toMatchObject({ code: 'SHIFT_ASSIGNMENT_NOT_FOUND' });
    await expect(shifts.service.updateByEmployee(2147483647, {
      durationMinutes: 480,
    })).rejects.toMatchObject({ code: 'SHIFT_ASSIGNMENT_NOT_FOUND' });
  });

  it('snapshots the old duration when a midnight absence races a shift update', async () => {
    const branchId = await createBranch('Midnight branch');
    const employeeId = await createEmployee(branchId, 1, 'Midnight employee', 600);
    const changedAt = new Date('2026-07-20T21:00:01.000Z');
    const shiftReader = createShiftsModule(database);
    const attendance = createDrizzleAttendanceRepository(database, {
      now: () => changedAt,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: (id, context, includeDeleted) => (
        shiftReader.service.readRequiredDurationForCheckIn(id, context, includeDeleted)
      ),
    });
    let signalShiftLocked!: () => void;
    let releaseShift!: () => void;
    const shiftLocked = new Promise<void>((resolve) => { signalShiftLocked = resolve; });
    const shiftReleased = new Promise<void>((resolve) => { releaseShift = resolve; });
    const shiftsWithAttendance = createShiftsModule(database, {
      async beforeDurationChange(id, oldDuration, context) {
        signalShiftLocked();
        await shiftReleased;
        return attendance.reconcileDueAbsencesForEmployee(
          id,
          oldDuration,
          context as Parameters<typeof attendance.reconcileDueAbsencesForEmployee>[2],
        );
      },
    });
    await attendance.ensureAbsenceJob(
      '2026-07-20',
      new Date('2026-07-20T21:00:00.000Z'),
    );

    const update = shiftsWithAttendance.service.updateByEmployee(employeeId, { durationMinutes: 480 });
    await shiftLocked;
    const generation = attendance.generateAbsences('2026-07-20');
    releaseShift();
    await Promise.all([update, generation]);

    expect((await database.select().from(attendanceDailyRecords))[0]).toMatchObject({
      employeeId,
      attendanceDate: '2026-07-20',
      absenceRequiredMinutes: 600,
    });
    expect((await database.select({ duration: employees.shiftDurationMinutes })
      .from(employees).where(eq(employees.id, employeeId)))[0]?.duration).toBe(480);
  });

  it('keeps the old snapshot when the absence worker wins the employee lock first', async () => {
    const branchId = await createBranch('Worker-first branch');
    const employeeId = await createEmployee(branchId, 1, 'Worker-first employee', 600);
    const changedAt = new Date('2026-07-20T21:00:01.000Z');
    const shiftReader = createShiftsModule(database);
    let signalWorkerLocked!: () => void;
    let releaseWorker!: () => void;
    const workerLocked = new Promise<void>((resolve) => { signalWorkerLocked = resolve; });
    const workerReleased = new Promise<void>((resolve) => { releaseWorker = resolve; });
    const attendance = createDrizzleAttendanceRepository(database, {
      now: () => changedAt,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      async readRequiredDuration(id, context, includeDeleted) {
        signalWorkerLocked();
        await workerReleased;
        return shiftReader.service.readRequiredDurationForCheckIn(id, context, includeDeleted);
      },
    });
    const shiftsWithAttendance = createShiftsModule(database, {
      beforeDurationChange: (id, oldDuration, context) => (
        attendance.reconcileDueAbsencesForEmployee(
          id,
          oldDuration,
          context as Parameters<typeof attendance.reconcileDueAbsencesForEmployee>[2],
        )
      ),
    });
    await attendance.ensureAbsenceJob(
      '2026-07-20',
      new Date('2026-07-20T21:00:00.000Z'),
    );

    const generation = attendance.generateAbsences('2026-07-20');
    await workerLocked;
    const update = shiftsWithAttendance.service.updateByEmployee(employeeId, { durationMinutes: 480 });
    releaseWorker();
    await Promise.all([generation, update]);

    expect((await database.select().from(attendanceDailyRecords))[0])
      .toMatchObject({ employeeId, absenceRequiredMinutes: 600 });
  });

  it('keeps the old snapshot when worker downtime left the ended date unscheduled', async () => {
    const branchId = await createBranch('Downtime branch');
    const employeeId = await createEmployee(branchId, 1, 'Downtime employee', 600);
    const changedAt = new Date('2026-07-20T21:00:01.000Z');
    const shiftReader = createShiftsModule(database);
    const attendance = createDrizzleAttendanceRepository(database, {
      now: () => changedAt,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: (id, context, includeDeleted) => (
        shiftReader.service.readRequiredDurationForCheckIn(id, context, includeDeleted)
      ),
    });
    const shiftsWithAttendance = createShiftsModule(database, {
      beforeDurationChange: (id, oldDuration, context) => (
        attendance.reconcileDueAbsencesForEmployee(
          id,
          oldDuration,
          context as Parameters<typeof attendance.reconcileDueAbsencesForEmployee>[2],
        )
      ),
    });
    await attendance.ensureAbsenceJob(
      '2026-07-19',
      new Date('2026-07-19T21:00:00.000Z'),
    );
    await attendance.complete((await database.select({ id: attendanceJobs.id })
      .from(attendanceJobs))[0]!.id);

    await shiftsWithAttendance.service.updateByEmployee(employeeId, { durationMinutes: 480 });
    await attendance.ensureAbsenceJob(
      '2026-07-20',
      new Date('2026-07-20T21:00:00.000Z'),
    );
    await attendance.generateAbsences('2026-07-20');

    expect((await database.select().from(attendanceDailyRecords)
      .where(eq(attendanceDailyRecords.attendanceDate, '2026-07-20')))[0])
      .toMatchObject({ employeeId, absenceRequiredMinutes: 600 });
  });
});
