import { createDatabase } from '@capella/database';
import {
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
  });

  it('reads the required-duration snapshot inside the caller transaction', async () => {
    const branchId = await createBranch('القاهرة');
    const employeeId = await createEmployee(branchId, 1, 'أحمد علي', 600);

    const snapshot = await database.transaction((transaction) => (
      shifts.service.readRequiredDurationForCheckIn(employeeId, transaction)
    ));

    expect(snapshot).toBe(600);
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
});
