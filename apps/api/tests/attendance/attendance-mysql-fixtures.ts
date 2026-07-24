import { createDatabase } from '@capella/database';
import {
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceEvents,
  attendanceJobs,
  attendanceSessions,
  auditEvents,
  authSessions,
  branches,
  deviceHistory,
  devicePairingRequests,
  devices,
  employeeBranchAssignments,
  employeeCodeSequence,
  employeeEmploymentPeriods,
  employeeImages,
  employeePhoneReservations,
  employeeSalaryPeriods,
  employees,
  payrollMonths,
} from '@capella/database/schema';

import { createDrizzleAttendanceRepository } from '../../src/modules/attendance/attendance-repository.js';

export const database = createDatabase(process.env.DATABASE_URL ?? '');
export const fixedNow = new Date('2026-07-20T09:00:00.000Z');

export const createFixtures = async () => {
  const branchResult = await database.insert(branches).values({
    name: 'فرع القاهرة',
    nameNormalized: `attendance-${Date.now()}`,
    location: 'القاهرة',
    latitude: 30.0444,
    longitude: 31.2357,
    gpsAccuracyMeters: 5,
    attendanceRadiusMeters: 150,
    hasEverBeenReferenced: true,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  const branchId = Number(branchResult[0].insertId);
  const employeeResult = await database.insert(employees).values({
    employeeCode: 42,
    fullName: 'موظف الحضور',
    personalPhone: '01000000042',
    whatsappPhone: '01000000042',
    pinHash: 'hash',
    credentialVersion: 3,
    age: 30,
    address: 'القاهرة',
    branchId,
    shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00',
    deletedAt: null,
    createdAt: new Date('2026-07-01T09:00:00.000Z'),
    updatedAt: fixedNow,
  });
  const employeeId = Number(employeeResult[0].insertId);
  await database.insert(employeeBranchAssignments).values({
    employeeId, branchId, effectiveFrom: new Date('2026-07-01T09:00:00.000Z'), createdAt: new Date('2026-07-01T09:00:00.000Z'),
  });
  const deviceResult = await database.insert(devices).values({
    assignmentType: 'employee',
    employeeId,
    branchId: null,
    installationMarkerHash: `${Date.now()}`.padStart(64, '1').slice(0, 64),
    browser: 'Chrome',
    platform: 'Android',
    status: 'active',
    pairedAt: fixedNow,
  });
  return { branchId, employeeId, deviceId: Number(deviceResult[0].insertId) };
};

export const cleanDatabase = async () => {
  await database.delete(auditEvents);
  await database.delete(attendanceEvents);
  await database.delete(attendanceDeniedAttempts);
  await database.delete(attendanceDailyRecords);
  await database.delete(attendanceJobs);
  await database.delete(attendanceSessions);
  await database.delete(payrollMonths);
  await database.delete(employeeSalaryPeriods);
  await database.delete(deviceHistory);
  await database.delete(devices);
  await database.delete(devicePairingRequests);
  await database.delete(authSessions);
  await database.delete(employeeImages);
  await database.delete(employeePhoneReservations);
  await database.delete(employeeBranchAssignments);
  await database.delete(employeeEmploymentPeriods);
  await database.delete(employees);
  await database.delete(employeeCodeSequence);
  await database.delete(branches);
};

export const mutation = (employeeId: number, deviceId: number, occurredAt = fixedNow) => ({
  employeeId,
  expectedCredentialVersion: 3,
  eventType: 'check_in' as const,
  source: 'personal_device' as const,
  deviceId,
  occurredAt,
  latitude: 30.0444,
  longitude: 31.2357,
  gpsAccuracyMeters: 8,
  distanceMeters: 0,
  branchLatitude: 30.0444,
  branchLongitude: 31.2357,
  branchRadiusMeters: 150,
});

export const repository = (
  readRequiredDuration: (employeeId: number, context: unknown) => Promise<number> = () => Promise.resolve(480),
) => createDrizzleAttendanceRepository(database, {
  now: () => fixedNow,
  timeZone: 'Africa/Cairo',
  isFinanciallyLocked: () => Promise.resolve(false),
  readRequiredDuration,
});
