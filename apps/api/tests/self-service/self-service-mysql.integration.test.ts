import { createHash } from 'node:crypto';

import { createDatabase } from '@capella/database';
import {
  advanceInstallments,
  advances,
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceEvents,
  attendanceJobs,
  attendanceSessions,
  authAttempts,
  authSessions,
  bonuses,
  branches,
  deductions,
  deviceHistory,
  devicePairingRequests,
  devices,
  employeeBranchAssignments,
  employeeCodeSequence,
  employeeImages,
  employeePhoneReservations,
  employeeSalaryPeriods,
  employees,
  financialAuditEvents,
  payrollMonths,
} from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createAdvanceModule } from '../../src/modules/advances/index.js';
import { createAuthModule } from '../../src/modules/auth/index.js';
import { createBonusModule } from '../../src/modules/bonuses/index.js';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createDeductionModule } from '../../src/modules/deductions/index.js';
import { createEmployeesModule } from '../../src/modules/employees/index.js';
import { createDrizzleAttendanceRepository } from '../../src/modules/attendance/index.js';
import { createPayrollModule } from '../../src/modules/payroll/index.js';
import { createSelfServiceModule } from '../../src/modules/self-service/index.js';
import { createWeeklyDayOffModule } from '../../src/modules/weekly-day-off/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const image = (name: string) => ({
  storagePath: `employees/${name}.jpg`, originalName: `${name}.jpg`, mimeType: 'image/jpeg', sizeBytes: 10,
});
const employeeInput = (branchId: number, name: string, phone: string) => ({
  fullName: name,
  personalPhone: phone,
  whatsappPhone: phone,
  pin: '1234',
  age: 30,
  address: 'القاهرة',
  branchId,
  shiftDurationMinutes: 480,
  monthlyBaseSalary: '5000.00',
  images: { personal: image(`${phone}-p`), idFront: image(`${phone}-f`), idBack: image(`${phone}-b`) },
});
const responseData = <T>(body: unknown) => (body as { data: T[] }).data;
const currentCairoMonth = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${read('year')}-${read('month')}`;
};
const currentCairoDate = (instant: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
};

const cleanupDatabase = async () => {
  await database.delete(financialAuditEvents);
  await database.delete(advanceInstallments);
  await database.delete(advances);
  await database.delete(bonuses);
  await database.delete(deductions);
  await database.delete(payrollMonths);
  await database.delete(employeeSalaryPeriods);
  await database.delete(attendanceEvents);
  await database.delete(attendanceDeniedAttempts);
  await database.delete(attendanceJobs);
  await database.delete(attendanceSessions);
  await database.delete(attendanceDailyRecords);
  await database.delete(deviceHistory);
  await database.delete(devices);
  await database.delete(devicePairingRequests);
  await database.delete(authAttempts);
  await database.delete(authSessions);
  await database.delete(employeeImages);
  await database.delete(employeePhoneReservations);
  await database.delete(employeeBranchAssignments);
  await database.delete(employees);
  await database.delete(employeeCodeSequence);
  await database.delete(branches);
};

beforeEach(cleanupDatabase);
afterEach(cleanupDatabase);

describe('MySQL-backed employee self-service', () => {
  it('returns only the authenticated employee records and never exposes secret or image fields', async () => {
    const branchModule = createBranchesModule(database);
    const employeeModule = createEmployeesModule(database, 16_777_216, { hasOpenSession: async () => false });
    const payrollModule = createPayrollModule(database);
    const bonusModule = createBonusModule(database);
    const deductionModule = createDeductionModule(database);
    const advanceModule = createAdvanceModule(database);
    const weeklyDayModule = createWeeklyDayOffModule(database, { isFinanciallyLocked: async () => false });
    const branch = await branchModule.service.create({
      name: 'الفرع الرئيسي', location: 'القاهرة', latitude: 30, longitude: 31,
      gpsAccuracyMeters: 5, attendanceRadiusMeters: 100,
    });
    const owner = await employeeModule.service.create(employeeInput(branch.id, 'صاحب الجلسة', '01012345678'));
    const other = await employeeModule.service.create(employeeInput(branch.id, 'موظف آخر', '01112345678'));

    const payrollMonth = currentCairoMonth();
    const payrollDate = `${payrollMonth}-01`;
    await bonusModule.service.create({ employeeId: owner.id, amount: '100.00', payrollMonth, reason: 'سبب' });
    await bonusModule.service.create({ employeeId: other.id, amount: '999.00', payrollMonth, reason: 'سبب آخر' });
    await deductionModule.service.create({ employeeId: owner.id, amount: '20.00', payrollMonth });
    await deductionModule.service.create({ employeeId: other.id, amount: '888.00', payrollMonth });
    await advanceModule.service.create({ employeeId: owner.id, amount: '200.00', installmentCount: 2, startMonth: payrollMonth });
    await advanceModule.service.create({ employeeId: other.id, amount: '777.00', installmentCount: 1, startMonth: payrollMonth });
    const now = new Date();
    await database.insert(attendanceDailyRecords).values([
      { employeeId: owner.id, attendanceDate: payrollDate, status: 'weekly_day_off', absenceRequiredMinutes: 480, dayOffConvertedAt: now, createdAt: now, updatedAt: now },
      { employeeId: other.id, attendanceDate: `${payrollMonth}-02`, status: 'weekly_day_off', absenceRequiredMinutes: 480, dayOffConvertedAt: now, createdAt: now, updatedAt: now },
    ]);
    await database.insert(attendanceSessions).values([
      {
        employeeId: owner.id, attendanceDate: currentCairoDate(now), requiredMinutes: 480,
        checkInAt: new Date(now.valueOf() - 60_000), checkOutAt: null,
        workedMinutes: null, overtimeMinutes: null, shortageMinutes: null,
        automaticTimeoutAt: null, automaticTimeoutCorrectedAt: null, flagged: false,
        createdAt: now, updatedAt: now,
      },
      {
        employeeId: owner.id, attendanceDate: `${payrollMonth}-03`, requiredMinutes: 480,
        checkInAt: new Date(`${payrollMonth}-03T06:00:00.000Z`), checkOutAt: new Date(`${payrollMonth}-03T14:00:00.000Z`),
        workedMinutes: 480, overtimeMinutes: 0, shortageMinutes: 0,
        automaticTimeoutAt: null, automaticTimeoutCorrectedAt: null, flagged: false,
        createdAt: now, updatedAt: now,
      },
      {
        employeeId: other.id, attendanceDate: `${payrollMonth}-04`, requiredMinutes: 480,
        checkInAt: new Date(`${payrollMonth}-04T06:00:00.000Z`), checkOutAt: new Date(`${payrollMonth}-04T14:00:00.000Z`),
        workedMinutes: 480, overtimeMinutes: 0, shortageMinutes: 0,
        automaticTimeoutAt: null, automaticTimeoutCorrectedAt: null, flagged: false,
        createdAt: now, updatedAt: now,
      },
    ]);
    await database.insert(payrollMonths).values([
      {
        employeeId: owner.id, payrollMonth: payrollDate, baseSalary: '5000.00', proratedBase: '5000.00',
        overtimeAmount: '0.00', bonusAmount: '0.00', attendanceDeductionAmount: '0.00', manualDeductionAmount: '0.00',
        advanceAmount: '0.00', priorNegativeCarry: '0.00', netSalary: '5000.00', eligibleWorkdays: 20,
        fullMonthWorkdays: 20, requiredMinutes: 9600, overtimeMinutes: 0, shortageMinutes: 0,
        finalizedAt: now, createdAt: now, updatedAt: now,
      },
      {
        employeeId: other.id, payrollMonth: payrollDate, baseSalary: '6000.00', proratedBase: '6000.00',
        overtimeAmount: '0.00', bonusAmount: '0.00', attendanceDeductionAmount: '0.00', manualDeductionAmount: '0.00',
        advanceAmount: '0.00', priorNegativeCarry: '0.00', netSalary: '6000.00', eligibleWorkdays: 20,
        fullMonthWorkdays: 20, requiredMinutes: 9600, overtimeMinutes: 0, shortageMinutes: 0,
        finalizedAt: now, createdAt: now, updatedAt: now,
      },
    ]);

    const token = 'owner-session-token';
    await database.insert(authSessions).values({
      id: 'owner-session',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      actorType: 'employee',
      employeeId: owner.id,
      createdAt: now,
      revokedAt: null,
    });
    const attendance = createDrizzleAttendanceRepository(database, {
      isFinanciallyLocked: async () => false,
      readRequiredDuration: async () => 480,
    });
    const authModule = createAuthModule({ database, attendance });
    const selfServiceModule = createSelfServiceModule({
      employees: employeeModule.service,
      branches: branchModule.service,
      attendance,
      weeklyDays: weeklyDayModule.service,
      payroll: payrollModule.service,
      bonuses: bonusModule.service,
      deductions: deductionModule.service,
      advances: advanceModule.service,
    });
    const app = createApp({ authService: authModule.service, selfServiceService: selfServiceModule.service });
    const cookie = { Cookie: `capella_session=${token}` };

    const [overview, attendanceResponse, bonusesResponse, deductionsResponse, advancesResponse, daysResponse, payrollResponse] = await Promise.all([
      request(app).get('/api/v1/self-service/overview').set(cookie),
      request(app).get('/api/v1/self-service/attendance').set(cookie),
      request(app).get('/api/v1/self-service/bonuses').set(cookie),
      request(app).get('/api/v1/self-service/deductions').set(cookie),
      request(app).get('/api/v1/self-service/advances').set(cookie),
      request(app).get('/api/v1/self-service/weekly-days').set(cookie),
      request(app).get(`/api/v1/self-service/payroll/${payrollMonth}`).set(cookie),
    ]);

    expect(overview.status).toBe(200);
    expect(overview.body.data.profile.fullName).toBe('صاحب الجلسة');
    expect(JSON.stringify(overview.body)).not.toMatch(/pin|image|storagePath|credential|latitude|longitude|Radius|employeeId/iu);
    expect(responseData<{ attendanceDate: string }>(attendanceResponse.body)).toEqual(expect.arrayContaining([
      expect.objectContaining({ attendanceDate: `${payrollMonth}-03`, state: 'closed' }),
      expect.objectContaining({ attendanceDate: currentCairoDate(now), state: 'open' }),
    ]));
    expect(JSON.stringify(attendanceResponse.body)).not.toMatch(/employeeId|employeeCode|employeeName|branchId|branchName|flagged/);
    expect(responseData<{ amount: string }>(bonusesResponse.body).map((item) => item.amount)).toEqual(['100.00']);
    expect(responseData<{ reason: string }>(bonusesResponse.body).map((item) => item.reason)).toEqual(['سبب']);
    expect(responseData<{ amount: string }>(deductionsResponse.body).map((item) => item.amount)).toEqual(['20.00']);
    expect(responseData<{ amount: string }>(advancesResponse.body).map((item) => item.amount)).toEqual(['200.00']);
    expect(responseData<{ attendanceDate: string }>(daysResponse.body).map((item) => item.attendanceDate)).toEqual([payrollDate]);
    expect(payrollResponse.status, JSON.stringify(payrollResponse.body)).toBe(200);
    expect(payrollResponse.body.data).toMatchObject({ payrollMonth, netSalary: '5000.00' });
    expect(JSON.stringify([bonusesResponse.body, deductionsResponse.body, advancesResponse.body, payrollResponse.body])).not.toContain('موظف آخر');

    const horizontal = await request(app).get(`/api/v1/self-service/bonuses?employeeId=${other.id}`).set(cookie);
    expect(horizontal.status).toBe(400);
  });

  it('serves an open Attendance-backed payroll preview to an authenticated checked-in employee while finalization stays blocked', async () => {
    const now = new Date('2026-08-01T09:00:00.000Z');
    const branchModule = createBranchesModule(database);
    const employeeModule = createEmployeesModule(database, 16_777_216, { hasOpenSession: async () => true });
    const bonusModule = createBonusModule(database, { now: () => now });
    const deductionModule = createDeductionModule(database, { now: () => now });
    const advanceModule = createAdvanceModule(database, { now: () => now });
    const weeklyDayModule = createWeeklyDayOffModule(database, { isFinanciallyLocked: async () => false });
    const branch = await branchModule.service.create({
      name: 'فرع الحضور', location: 'القاهرة', latitude: 30, longitude: 31,
      gpsAccuracyMeters: 5, attendanceRadiusMeters: 100,
    });
    const owner = await employeeModule.service.create(employeeInput(branch.id, 'موظف حاضر', '01087654321'));
    await database.update(employees).set({ createdAt: new Date('2026-07-01T00:00:00.000Z') })
      .where(eq(employees.id, owner.id));

    await database.insert(attendanceSessions).values({
      employeeId: owner.id,
      attendanceDate: '2026-07-31',
      requiredMinutes: 480,
      checkInAt: new Date('2026-07-31T20:00:00.000Z'),
      checkOutAt: null,
      workedMinutes: null,
      overtimeMinutes: null,
      shortageMinutes: null,
      automaticTimeoutAt: null,
      automaticTimeoutCorrectedAt: null,
      flagged: false,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(attendanceDailyRecords).values(Array.from({ length: 31 }, (_, index) => index + 1)
      .filter((day) => day !== 31)
      .map((day) => ({
        employeeId: owner.id,
        attendanceDate: `2026-07-${String(day).padStart(2, '0')}`,
        status: 'absence' as const,
        absenceRequiredMinutes: 480,
        dayOffConvertedAt: null,
        createdAt: now,
        updatedAt: now,
      })));

    const attendance = createDrizzleAttendanceRepository(database, {
      now: () => now,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: async () => false,
      readRequiredDuration: async () => 480,
    });
    const payrollModule = createPayrollModule(database, {
      now: () => now,
      timeZone: 'Africa/Cairo',
      attendance,
    });
    const token = 'checked-in-owner-session';
    await database.insert(authSessions).values({
      id: 'checked-in-owner-session',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      actorType: 'employee',
      employeeId: owner.id,
      createdAt: now,
      revokedAt: null,
    });
    const selfServiceModule = createSelfServiceModule({
      employees: employeeModule.service,
      branches: branchModule.service,
      attendance,
      weeklyDays: weeklyDayModule.service,
      payroll: payrollModule.service,
      bonuses: bonusModule.service,
      deductions: deductionModule.service,
      advances: advanceModule.service,
    });
    const app = createApp({
      authService: createAuthModule({ database, attendance }).service,
      selfServiceService: selfServiceModule.service,
    });

    const preview = await request(app).get('/api/v1/self-service/payroll/2026-07')
      .set({ Cookie: `capella_session=${token}` });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data).toMatchObject({ payrollMonth: '2026-07', status: 'open' });
    await expect(payrollModule.service.finalize(owner.id, '2026-07'))
      .rejects.toMatchObject({ code: 'PAYROLL_BLOCKED', reasons: ['OPEN_SESSION'] });
  });
});
