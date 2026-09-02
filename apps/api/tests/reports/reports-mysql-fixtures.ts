import { createDatabase } from '@capella/database';
import {
  advanceInstallments,
  advances,
  auditEvents,
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceSessions,
  authSessions,
  bonuses,
  branches,
  deductions,
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
  reportExports,
} from '@capella/database/schema';

export const database = createDatabase(process.env.DATABASE_URL ?? '');
export const now = new Date('2026-07-19T08:00:00.000Z');

export const clear = async () => {
  await database.delete(auditEvents);
  await database.delete(reportExports);
  await database.delete(advanceInstallments);
  await database.delete(advances);
  await database.delete(bonuses);
  await database.delete(deductions);
  await database.delete(payrollMonths);
  await database.delete(employeeSalaryPeriods);
  await database.delete(attendanceDeniedAttempts);
  await database.delete(attendanceDailyRecords);
  await database.delete(attendanceSessions);
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

export const seed = async () => {
  const branchId = Number((await database.insert(branches).values({
    name: 'فرع القاهرة',
    nameNormalized: 'cairo-report-branch',
    location: 'وسط البلد',
    latitude: 30.0444,
    longitude: 31.2357,
    gpsAccuracyMeters: 4,
    attendanceRadiusMeters: 50,
    hasEverBeenReferenced: true,
    createdAt: now,
    updatedAt: now,
  }))[0].insertId);
  const employeeId = Number((await database.insert(employees).values({
    employeeCode: 1,
    fullName: 'أحمد علي',
    personalPhone: '01000000001',
    whatsappPhone: '01100000001',
    pinHash: 'must-never-appear',
    credentialVersion: 1,
    age: 30,
    address: 'القاهرة',
    branchId,
    shiftDurationMinutes: 600,
    monthlyBaseSalary: '6000.00',
    createdAt: now,
    updatedAt: now,
  }))[0].insertId);
  const deletedEmployeeId = Number((await database.insert(employees).values({
    employeeCode: 2,
    fullName: 'موظف محذوف',
    personalPhone: '01000000002',
    whatsappPhone: '01100000002',
    pinHash: 'deleted-pin-hash',
    credentialVersion: 2,
    age: 35,
    address: 'الجيزة',
    branchId,
    shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00',
    deletedAt: now,
    createdAt: now,
    updatedAt: now,
  }))[0].insertId);
  await database.insert(employeeBranchAssignments).values([
    { employeeId, branchId, effectiveFrom: now, createdAt: now },
    { employeeId: deletedEmployeeId, branchId, effectiveFrom: now, createdAt: now },
  ]);
  await database.insert(devices).values({
    assignmentType: 'employee',
    employeeId,
    installationMarkerHash: 'b'.repeat(64),
    browser: 'Mobile Safari',
    platform: 'iOS',
    status: 'active',
    pairedAt: now,
  });
  await database.insert(attendanceDailyRecords).values({
    employeeId: deletedEmployeeId,
    branchId,
    attendanceDate: '2026-07-12',
    status: 'weekly_day_off',
    absenceRequiredMinutes: 480,
    dayOffConvertedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(attendanceSessions).values({
    employeeId,
    branchId,
    attendanceDate: '2026-07-19',
    requiredMinutes: 600,
    checkInAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(bonuses).values({
    employeeId,
    payrollMonth: '2026-07-01',
    amount: '100.00',
    reason: 'أداء استثنائي',
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(deductions).values({
    employeeId: deletedEmployeeId,
    payrollMonth: '2026-07-01',
    amount: '25.00',
    reason: 'Late arrival',
    createdAt: now,
    updatedAt: now,
  });
  const advanceId = Number((await database.insert(advances).values({
    employeeId,
    amount: '80.00',
    installmentCount: 2,
    startMonth: '2026-07-01',
    createdAt: now,
    updatedAt: now,
  }))[0].insertId);
  await database.insert(advanceInstallments).values([
    { advanceId, employeeId, ordinal: 1, payrollMonth: '2026-07-01', amount: '40.00', createdAt: now },
    { advanceId, employeeId, ordinal: 2, payrollMonth: '2026-08-01', amount: '40.00', createdAt: now },
  ]);
  return { branchId, employeeId, deletedEmployeeId, advanceId };
};

