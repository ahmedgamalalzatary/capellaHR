import { createDatabase } from '@capella/database';
import {
  advanceInstallments,
  advances,
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceEvents,
  attendanceJobs,
  attendanceSessions,
  auditEvents,
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
  reportExports,
} from '@capella/database/schema';
import type { SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDashboardModule } from '../../src/modules/dashboard/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const fixedNow = new Date('2026-07-20T09:00:00.000Z');
type Transaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
type SqlCompiler = (this: object) => { params?: unknown[] };
type SqlGetter = (this: object) => SQL;
type QueryThen = (
  this: object,
  onFulfilled?: (rows: unknown) => unknown,
  onRejected?: (error: unknown) => unknown,
) => unknown;
const isSqlCompiler = (value: unknown): value is SqlCompiler => typeof value === 'function';
const isSqlGetter = (value: unknown): value is SqlGetter => typeof value === 'function';
const isQueryThen = (value: unknown): value is QueryThen => typeof value === 'function';
const sqlDialect = new MySqlDialect();
const rawSql = (value: unknown): SQL | null => {
  if (typeof value !== 'object' || value === null) return null;
  const getSql: unknown = Reflect.get(value, 'getSQL');
  return isSqlGetter(getSql) ? getSql.call(value) : value as SQL;
};

const countingDatabase = () => {
  let queryCount = 0;
  let maxSelectedRows = 0;
  let maxParameterCount = 0;
  let executeParameterCount = 0;
  const observeQuery = (query: object): object => new Proxy(query, {
    get(target, property, receiver): unknown {
      if (property === 'then') {
        const toSql = Reflect.get(target, 'toSQL', receiver);
        if (isSqlCompiler(toSql)) {
          const compiled = toSql.call(target);
          maxParameterCount = Math.max(maxParameterCount, compiled.params?.length ?? 0);
        }
        const then = Reflect.get(target, property, receiver);
        if (!isQueryThen(then)) return then;
        return (onFulfilled?: (rows: unknown) => unknown, onRejected?: (error: unknown) => unknown) => (
          then.call(target,
            (rows: unknown) => {
              const selectedRows = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
              if (Array.isArray(selectedRows)) maxSelectedRows = Math.max(maxSelectedRows, selectedRows.length);
              return onFulfilled?.(rows) ?? rows;
            },
            onRejected,
          )
        );
      }
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args) as unknown;
        return typeof result === 'object' && result !== null ? observeQuery(result) : result;
      };
    },
  });
  const wrapTransaction = (transaction: Transaction) => new Proxy(transaction, {
    get(target, property, receiver): unknown {
      const value: unknown = Reflect.get(target, property, receiver);
      if ((property === 'select' || property === 'execute') && typeof value === 'function') {
        return (...args: unknown[]) => {
          queryCount += 1;
          if (property === 'execute') {
            const statement = rawSql(args[0]);
            if (statement) {
              const parameterCount = sqlDialect.sqlToQuery(statement).params.length;
              executeParameterCount = Math.max(executeParameterCount, parameterCount);
              maxParameterCount = Math.max(maxParameterCount, parameterCount);
            }
          }
          const result = Reflect.apply(value, target, args) as object;
          return observeQuery(result);
        };
      }
      const result: unknown = typeof value === 'function' ? value.bind(target) : value;
      return result;
    },
  });
  const wrapped = new Proxy(database, {
    get(target, property, receiver): unknown {
      if (property === 'transaction') {
        return <T>(callback: (transaction: Transaction) => Promise<T>) => target.transaction(
          (transaction) => callback(wrapTransaction(transaction)),
        );
      }
      const value: unknown = Reflect.get(target, property, receiver);
      const result: unknown = typeof value === 'function' ? value.bind(target) : value;
      return result;
    },
  });
  return {
    database: wrapped,
    queryCount: () => queryCount,
    maxSelectedRows: () => maxSelectedRows,
    maxParameterCount: () => maxParameterCount,
    executeParameterCount: () => executeParameterCount,
  };
};

const cleanup = async () => {
  await database.delete(auditEvents);
  await database.delete(reportExports);
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

beforeEach(cleanup);
afterEach(cleanup);

const seed = async () => {
  const branchId = Number((await database.insert(branches).values({
    name: 'فرع العمليات', nameNormalized: 'dashboard-operations', location: 'القاهرة',
    latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 100,
    hasEverBeenReferenced: true, createdAt: fixedNow, updatedAt: fixedNow,
  }))[0].insertId);
  const addEmployee = async (employeeCode: number, fullName: string, createdAt: Date) => Number((
    await database.insert(employees).values({
      employeeCode, fullName,
      personalPhone: `010${String(employeeCode).padStart(8, '0')}`,
      whatsappPhone: `011${String(employeeCode).padStart(8, '0')}`,
      pinHash: `secret-${employeeCode}`, credentialVersion: 1, age: 30, address: 'القاهرة',
      branchId, shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00',
      deletedAt: null, createdAt, updatedAt: fixedNow,
    })
  )[0].insertId);

  const current = await addEmployee(1, 'حاضر الآن', new Date('2026-07-01T06:00:00.000Z'));
  const stale = await addEmployee(2, 'جلسة سابقة مفتوحة', new Date('2026-07-01T06:00:00.000Z'));
  const missing = await addEmployee(3, 'لم يحضر', new Date('2026-06-01T06:00:00.000Z'));
  await addEmployee(4, 'موظف جديد اليوم', new Date('2026-07-19T22:00:00.000Z'));
  const timedOut = await addEmployee(5, 'خروج تلقائي', new Date('2026-07-01T06:00:00.000Z'));

  await database.insert(attendanceSessions).values([
    {
      employeeId: current, attendanceDate: '2026-07-20', requiredMinutes: 480,
      checkInAt: new Date('2026-07-20T06:00:00.000Z'), checkOutAt: null,
      workedMinutes: null, overtimeMinutes: null, shortageMinutes: null,
      automaticTimeoutAt: null, automaticTimeoutCorrectedAt: null, flagged: false,
      createdAt: fixedNow, updatedAt: fixedNow,
    },
    {
      employeeId: stale, attendanceDate: '2026-07-19', requiredMinutes: 480,
      checkInAt: new Date('2026-07-19T18:00:00.000Z'), checkOutAt: null,
      workedMinutes: null, overtimeMinutes: null, shortageMinutes: null,
      automaticTimeoutAt: null, automaticTimeoutCorrectedAt: null, flagged: false,
      createdAt: fixedNow, updatedAt: fixedNow,
    },
    {
      employeeId: timedOut, attendanceDate: '2026-07-18', requiredMinutes: 480,
      checkInAt: new Date('2026-07-18T05:00:00.000Z'),
      checkOutAt: new Date('2026-07-18T21:00:00.000Z'),
      workedMinutes: 960, overtimeMinutes: 480, shortageMinutes: 0,
      automaticTimeoutAt: new Date('2026-07-18T21:00:00.000Z'),
      automaticTimeoutCorrectedAt: null, flagged: true,
      createdAt: fixedNow, updatedAt: fixedNow,
    },
  ]);
  await database.insert(attendanceDailyRecords).values([
    {
      employeeId: missing, attendanceDate: '2026-07-18', status: 'absence',
      absenceRequiredMinutes: 480, dayOffConvertedAt: null,
      createdAt: new Date('2026-07-19T00:00:00.000Z'), updatedAt: fixedNow,
    },
    {
      employeeId: timedOut, attendanceDate: '2026-07-17', status: 'weekly_day_off',
      absenceRequiredMinutes: 480, dayOffConvertedAt: new Date('2026-07-19T08:00:00.000Z'),
      createdAt: new Date('2026-07-18T00:00:00.000Z'), updatedAt: fixedNow,
    },
  ]);
  await database.insert(attendanceDeniedAttempts).values([
    {
      eventType: 'check_in', claimedEmployeeCode: 3, employeeId: missing,
      source: 'personal_device', occurredAt: new Date('2026-07-20T08:00:00.000Z'),
      failureReason: 'OUT_OF_RANGE', suspicious: true, createdAt: fixedNow,
    },
    {
      eventType: 'check_out', claimedEmployeeCode: 2, employeeId: stale,
      source: 'branch_device', occurredAt: new Date('2026-07-20T07:00:00.000Z'),
      failureReason: 'TECHNICAL_FAILURE', suspicious: false, createdAt: fixedNow,
    },
    {
      eventType: 'check_in', claimedEmployeeCode: 1, employeeId: current,
      source: 'personal_device', occurredAt: new Date('2026-07-19T07:00:00.000Z'),
      failureReason: 'OLD_REVIEWED', suspicious: true, dismissedAt: fixedNow, createdAt: fixedNow,
    },
  ]);

  await database.insert(devices).values({
    assignmentType: 'employee', employeeId: current, branchId: null,
    credentialId: 'dashboard-credential', credentialIdHash: 'a'.repeat(64),
    credentialPublicKey: 'public-key', counter: 0, transports: [],
    credentialDeviceType: 'singleDevice', credentialBackedUp: false,
    installationMarkerHash: 'b'.repeat(64), browser: 'Chrome', platform: 'Android',
    status: 'active', pairedAt: fixedNow,
  });
  await database.insert(devicePairingRequests).values([
    {
      assignmentType: 'employee', employeeId: current, branchId: null,
      tokenHash: 'c'.repeat(64), status: 'pending', registrationChallenge: 'issued-challenge', createdAt: fixedNow,
    },
    {
      assignmentType: 'branch', employeeId: null, branchId,
      tokenHash: 'd'.repeat(64), status: 'pending', createdAt: new Date(fixedNow.getTime() - 1000),
    },
  ]);

  const exportStatus = ['queued', 'processing', 'completed', 'failed'] as const;
  await database.insert(reportExports).values(exportStatus.map((status, index) => ({
    reportType: 'attendance' as const, status, filters: {}, selection: {},
    attemptCount: status === 'failed' ? 3 : index, cycleAttemptCount: status === 'failed' ? 3 : index,
    retryCount: 0, failureReason: status === 'failed' ? 'PDF_EXPORT_FAILED' : null,
    queuedAt: new Date(fixedNow.getTime() - index * 1000),
    startedAt: status === 'processing' || status === 'failed' ? fixedNow : null,
    completedAt: status === 'completed' ? fixedNow : null,
    failedAt: status === 'failed' ? fixedNow : null,
    createdAt: fixedNow, updatedAt: fixedNow,
  })));

  return { branchId, current, stale, missing, timedOut };
};

const createModule = (now: Date) => {
  return createDashboardModule(database, {
    now: () => now, timeZone: 'Africa/Cairo',
  });
};

describe('MySQL-backed Dashboard snapshot', () => {
  it('aggregates every locked operational summary without leaking secrets', async () => {
    await seed();
    const snapshot = await createModule(fixedNow).service.getSnapshot();

    expect(snapshot).toMatchObject({
      generatedAt: fixedNow.toISOString(), cairoDate: '2026-07-20', payrollMonth: '2026-06',
      currentlyCheckedIn: { total: 1, items: [expect.objectContaining({ employeeCode: 1 })] },
      previousDayOpen: { total: 1, items: [expect.objectContaining({ employeeCode: 2 })] },
      notCheckedIn: { total: 2 },
      attendanceReview: { unresolvedTotal: 2, flaggedTotal: 1 },
      automaticTimeouts: { total: 1, items: [expect.objectContaining({ employeeCode: 5 })] },
      devicePairings: { pendingTotal: 2, replacementTotal: 1 },
      payrollBlockers: { total: 1, items: [expect.objectContaining({
        employeeCode: 3, reasons: ['ATTENDANCE_RECONCILIATION_PENDING'],
      })] },
      pdfExports: { queued: 1, processing: 1, completed: 1, failed: 1 },
    });
    expect(snapshot.latestDailyRecords.items.map((item) => item.status))
      .toEqual(['absence', 'weekly_day_off']);
    expect(snapshot.latestDailyRecords.items[0]?.occurredAt).toBe(fixedNow.toISOString());
    expect(snapshot.notCheckedIn.items.map((item) => item.employeeCode))
      .toEqual([3, 5]);
    expect(snapshot.devicePairings.items.map((item) => item.kind))
      .toEqual(['replacement', 'pairing']);
    expect(snapshot.devicePairings.items.map((item) => item.optionsIssued))
      .toEqual([true, false]);
    expect(JSON.stringify(snapshot)).not.toMatch(/pinHash|secret-|credential|tokenHash|latitude|longitude/);
  });

  it('changes the operational date exactly at Cairo midnight', async () => {
    await seed();
    const before = await createModule(new Date('2026-07-19T20:59:59.999Z')).service.getSnapshot();
    const after = await createModule(new Date('2026-07-19T21:00:00.000Z')).service.getSnapshot();

    expect(before.cairoDate).toBe('2026-07-19');
    expect(before.currentlyCheckedIn.items.map((item) => item.employeeCode)).toEqual([2]);
    expect(before.previousDayOpen.total).toBe(0);
    expect(after.cairoDate).toBe('2026-07-20');
    expect(after.currentlyCheckedIn.items.map((item) => item.employeeCode)).toEqual([1]);
    expect(after.previousDayOpen.items.map((item) => item.employeeCode)).toEqual([2]);
  });

  it('does not add an amount-range blocker before attendance reconciliation succeeds', async () => {
    const { missing } = await seed();
    await database.insert(bonuses).values(Array.from({ length: 101 }, () => ({
      employeeId: missing,
      amount: '9999999999.99',
      payrollMonth: '2026-06-01',
      createdAt: fixedNow,
      updatedAt: fixedNow,
    })));

    const snapshot = await createModule(fixedNow).service.getSnapshot();
    const blocker = snapshot.payrollBlockers.items.find((item) => item.employeeCode === 3);
    expect(blocker?.reasons).toEqual(['ATTENDANCE_RECONCILIATION_PENDING']);
  });

  it('returns each pending pairing once when an assignment has multiple active devices', async () => {
    const { current } = await seed();
    await database.insert(devices).values({
      assignmentType: 'employee', employeeId: current, branchId: null,
      credentialId: 'dashboard-credential-duplicate', credentialIdHash: 'e'.repeat(64),
      credentialPublicKey: 'public-key-duplicate', counter: 0, transports: [],
      credentialDeviceType: 'singleDevice', credentialBackedUp: false,
      installationMarkerHash: 'f'.repeat(64), browser: 'Firefox', platform: 'Android',
      status: 'active', pairedAt: fixedNow,
    });

    const snapshot = await createModule(fixedNow).service.getSnapshot();
    expect(snapshot.devicePairings).toMatchObject({ pendingTotal: 2, replacementTotal: 1 });
    expect(snapshot.devicePairings.items).toHaveLength(2);
    expect(new Set(snapshot.devicePairings.items.map((item) => item.id)).size).toBe(2);
  });

  it('keeps snapshot query growth constant as employees and pairing requests increase', async () => {
    const { branchId } = await seed();
    const baseline = countingDatabase();
    await createDashboardModule(baseline.database, {
      now: () => fixedNow, timeZone: 'Africa/Cairo',
    }).service.getSnapshot();

    const extraEmployees = [];
    for (let index = 0; index < 8; index += 1) {
      const employeeId = Number((await database.insert(employees).values({
        employeeCode: 100 + index, fullName: `Scale ${index}`,
        personalPhone: `012${String(index).padStart(8, '0')}`,
        whatsappPhone: `015${String(index).padStart(8, '0')}`,
        pinHash: `scale-secret-${index}`, credentialVersion: 1, age: 30, address: 'Cairo',
        branchId, shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00',
        deletedAt: null, createdAt: new Date('2026-06-01T06:00:00.000Z'), updatedAt: fixedNow,
      }))[0].insertId);
      extraEmployees.push(employeeId);
    }
    await database.insert(devicePairingRequests).values(extraEmployees.map((employeeId, index) => ({
      assignmentType: 'employee' as const, employeeId, branchId: null,
      tokenHash: String(index + 1).repeat(64), status: 'pending' as const, createdAt: fixedNow,
    })));
    const historyEmployee = Number((await database.insert(employees).values({
      employeeCode: 200, fullName: 'Historical Scale', personalPhone: '01299999999',
      whatsappPhone: '01599999999', pinHash: 'history-secret', credentialVersion: 1,
      age: 30, address: 'Cairo', branchId, shiftDurationMinutes: 480,
      monthlyBaseSalary: '5000.00', deletedAt: null,
      createdAt: new Date('2024-01-01T06:00:00.000Z'), updatedAt: fixedNow,
    }))[0].insertId);
    const historyMonths = Array.from({ length: 8 }, (_, index) => `2025-${String(index + 1).padStart(2, '0')}`);
    await database.insert(attendanceSessions).values(historyMonths.map((month) => ({
      employeeId: historyEmployee, attendanceDate: `${month}-01`, requiredMinutes: 480,
      checkInAt: new Date(`${month}-01T06:00:00.000Z`), checkOutAt: new Date(`${month}-01T14:00:00.000Z`),
      workedMinutes: 480, overtimeMinutes: 0, shortageMinutes: 0,
      automaticTimeoutAt: null, automaticTimeoutCorrectedAt: null, flagged: false,
      createdAt: fixedNow, updatedAt: fixedNow,
    })));
    await database.insert(attendanceDailyRecords).values(historyMonths.map((month) => ({
      employeeId: historyEmployee, attendanceDate: `${month}-02`, status: 'absence' as const,
      absenceRequiredMinutes: 480, dayOffConvertedAt: null, createdAt: fixedNow, updatedAt: fixedNow,
    })));
    await database.insert(bonuses).values(historyMonths.map((month) => ({
      employeeId: historyEmployee, payrollMonth: `${month}-01`, amount: '10.00',
      createdAt: fixedNow, updatedAt: fixedNow,
    })));
    await database.insert(deductions).values(historyMonths.map((month) => ({
      employeeId: historyEmployee, payrollMonth: `${month}-01`, amount: '5.00',
      createdAt: fixedNow, updatedAt: fixedNow,
    })));

    const scaled = countingDatabase();
    await createDashboardModule(scaled.database, {
      now: () => fixedNow, timeZone: 'Africa/Cairo',
    }).service.getSnapshot();

    expect(scaled.queryCount()).toBe(baseline.queryCount());
    expect(scaled.maxSelectedRows()).toBeLessThanOrEqual(5);
    expect(scaled.executeParameterCount()).toBeGreaterThan(0);
    expect(scaled.executeParameterCount()).toBe(baseline.executeParameterCount());
    expect(scaled.maxParameterCount()).toBe(baseline.maxParameterCount());
  });
});
