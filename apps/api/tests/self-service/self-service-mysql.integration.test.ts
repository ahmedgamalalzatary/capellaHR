import { createHash } from 'node:crypto';

import { createDatabase } from '@capella/database';
import {
  advanceInstallments,
  advances,
  attendanceDailyRecords,
  authAttempts,
  authSessions,
  bonuses,
  branches,
  deductions,
  deviceAuthenticationChallenges,
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
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createAdvanceModule } from '../../src/modules/advances/index.js';
import { createAuthModule } from '../../src/modules/auth/index.js';
import { createBonusModule } from '../../src/modules/bonuses/index.js';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createDeductionModule } from '../../src/modules/deductions/index.js';
import { createEmployeesModule } from '../../src/modules/employees/index.js';
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

const cleanupDatabase = async () => {
  await database.delete(financialAuditEvents);
  await database.delete(advanceInstallments);
  await database.delete(advances);
  await database.delete(bonuses);
  await database.delete(deductions);
  await database.delete(payrollMonths);
  await database.delete(employeeSalaryPeriods);
  await database.delete(attendanceDailyRecords);
  await database.delete(deviceAuthenticationChallenges);
  await database.delete(deviceHistory);
  await database.delete(devices);
  await database.delete(devicePairingRequests);
  await database.delete(authAttempts);
  await database.delete(authSessions);
  await database.delete(employeeImages);
  await database.delete(employeePhoneReservations);
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
    await bonusModule.service.create({ employeeId: owner.id, amount: '100.00', payrollMonth });
    await bonusModule.service.create({ employeeId: other.id, amount: '999.00', payrollMonth });
    await deductionModule.service.create({ employeeId: owner.id, amount: '20.00', payrollMonth });
    await deductionModule.service.create({ employeeId: other.id, amount: '888.00', payrollMonth });
    await advanceModule.service.create({ employeeId: owner.id, amount: '200.00', installmentCount: 2, startMonth: payrollMonth });
    await advanceModule.service.create({ employeeId: other.id, amount: '777.00', installmentCount: 1, startMonth: payrollMonth });
    const now = new Date();
    await database.insert(attendanceDailyRecords).values([
      { employeeId: owner.id, attendanceDate: payrollDate, status: 'weekly_day_off', absenceRequiredMinutes: 480, dayOffConvertedAt: now, createdAt: now, updatedAt: now },
      { employeeId: other.id, attendanceDate: `${payrollMonth}-02`, status: 'weekly_day_off', absenceRequiredMinutes: 480, dayOffConvertedAt: now, createdAt: now, updatedAt: now },
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
    const authModule = createAuthModule({ database });
    const selfServiceModule = createSelfServiceModule({
      employees: employeeModule.service,
      branches: branchModule.service,
      weeklyDays: weeklyDayModule.service,
      payroll: payrollModule.service,
      bonuses: bonusModule.service,
      deductions: deductionModule.service,
      advances: advanceModule.service,
    });
    const app = createApp({ authService: authModule.service, selfServiceService: selfServiceModule.service });
    const cookie = { Cookie: `capella_session=${token}` };

    const [overview, bonusesResponse, deductionsResponse, advancesResponse, daysResponse, payrollResponse] = await Promise.all([
      request(app).get('/api/v1/self-service/overview').set(cookie),
      request(app).get('/api/v1/self-service/bonuses').set(cookie),
      request(app).get('/api/v1/self-service/deductions').set(cookie),
      request(app).get('/api/v1/self-service/advances').set(cookie),
      request(app).get('/api/v1/self-service/weekly-days').set(cookie),
      request(app).get(`/api/v1/self-service/payroll/${payrollMonth}`).set(cookie),
    ]);

    expect(overview.status).toBe(200);
    expect(overview.body.data.profile.fullName).toBe('صاحب الجلسة');
    expect(JSON.stringify(overview.body)).not.toMatch(/pin|image|storagePath|credential|latitude|longitude|Radius|employeeId/iu);
    expect(responseData<{ amount: string }>(bonusesResponse.body).map((item) => item.amount)).toEqual(['100.00']);
    expect(responseData<{ amount: string }>(deductionsResponse.body).map((item) => item.amount)).toEqual(['20.00']);
    expect(responseData<{ amount: string }>(advancesResponse.body).map((item) => item.amount)).toEqual(['200.00']);
    expect(responseData<{ attendanceDate: string }>(daysResponse.body).map((item) => item.attendanceDate)).toEqual([payrollDate]);
    expect(payrollResponse.status, JSON.stringify(payrollResponse.body)).toBe(200);
    expect(payrollResponse.body.data).toMatchObject({ payrollMonth, netSalary: '5000.00' });
    expect(JSON.stringify([bonusesResponse.body, deductionsResponse.body, advancesResponse.body, payrollResponse.body])).not.toContain('موظف آخر');

    const horizontal = await request(app).get(`/api/v1/self-service/bonuses?employeeId=${other.id}`).set(cookie);
    expect(horizontal.status).toBe(400);
  });
});
