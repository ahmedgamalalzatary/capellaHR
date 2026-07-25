import {
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceEvents,
  attendanceSessions,
  auditEvents,
  authSessions,
  branches,
  employeeBranchAssignments,
  employeeEmploymentPeriods,
  employees,
} from '@capella/database/schema';
import { and, asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleAttendanceRepository } from '../../src/modules/attendance/attendance-repository.js';
import { createDrizzleAuthRepositories } from '../../src/modules/auth/auth-repositories.js';
import {
  createDeviceLoginEligibility,
  createDrizzleDeviceRepository,
} from '../../src/modules/devices/devices-repository.js';
import {
  createFixtures,
  cleanDatabase,
  database,
  fixedNow,
  mutation,
  repository,
} from './attendance-mysql-fixtures.js';

beforeEach(cleanDatabase);
afterEach(cleanDatabase);

describe('MySQL-backed attendance sessions', () => {
  it('snapshots the original branch for backdated attendance created after reassignment', async () => {
    const { branchId, employeeId } = await createFixtures();
    const sessionAt = new Date('2026-07-19T06:00:00.000Z');
    const newBranchResult = await database.insert(branches).values({
      name: 'New attendance branch', nameNormalized: `new-attendance-${Date.now()}`,
      location: 'Giza', latitude: 30, longitude: 31, gpsAccuracyMeters: 5,
      attendanceRadiusMeters: 100, hasEverBeenReferenced: true, createdAt: fixedNow, updatedAt: fixedNow,
    });
    const newBranchId = Number(newBranchResult[0].insertId);
    await database.update(employeeBranchAssignments).set({ effectiveTo: fixedNow })
      .where(and(eq(employeeBranchAssignments.employeeId, employeeId), eq(employeeBranchAssignments.branchId, branchId)));
    await database.insert(employeeBranchAssignments).values({ employeeId, branchId: newBranchId, effectiveFrom: fixedNow, createdAt: fixedNow });
    await database.update(employees).set({ branchId: newBranchId, updatedAt: fixedNow }).where(eq(employees.id, employeeId));
    await expect(repository().manualCheckIn({ employeeId, occurredAt: sessionAt }))
      .resolves.toMatchObject({ kind: 'success' });

    const result = await repository().listSessions({ page: 1, pageSize: 20 });
    expect(result.items[0]).toMatchObject({ employeeId, branchId });
    expect((await repository().listSessions({ branchId, page: 1, pageSize: 20 })).total).toBe(1);
    expect((await repository().listSessions({ branchId: newBranchId, page: 1, pageSize: 20 })).total).toBe(0);
  });
  it('serializes concurrent check-ins into one session for the Cairo date', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const repo = repository();

    const results = await Promise.all([
      repo.checkIn(mutation(employeeId, deviceId)),
      repo.checkIn(mutation(employeeId, deviceId)),
    ]);

    expect(results.filter(({ kind }) => kind === 'success')).toHaveLength(1);
    expect(results.filter(({ kind }) => kind === 'session_exists')).toHaveLength(1);
    expect(await database.select().from(attendanceSessions)).toHaveLength(1);
    expect(await database.select().from(attendanceEvents)).toHaveLength(1);
  });

  it('captures the required duration through the transaction-aware Shifts gateway', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const readRequiredDuration = vi.fn(async () => 360);
    const repo = repository(readRequiredDuration);

    const result = await repo.checkIn(mutation(employeeId, deviceId));

    expect(result).toMatchObject({ kind: 'success', session: { requiredMinutes: 360 } });
    expect(readRequiredDuration).toHaveBeenCalledWith(employeeId, expect.anything(), false);
  });

  it('uses the historical Shift gateway mode for an eligible deletion-date manual event', async () => {
    const { employeeId } = await createFixtures();
    const deletedAt = new Date('2026-07-20T10:00:00.000Z');
    await database.update(employees).set({ deletedAt }).where(eq(employees.id, employeeId));
    const readRequiredDuration = vi.fn(async () => 480);
    const repo = repository(readRequiredDuration);

    await expect(repo.manualCheckIn({
      employeeId,
      occurredAt: new Date('2026-07-20T09:59:59.999Z'),
    })).resolves.toMatchObject({ kind: 'success', session: { requiredMinutes: 480 } });
    expect(readRequiredDuration).toHaveBeenCalledWith(employeeId, expect.anything(), true);
  });

  it('closes the open session with whole-minute overtime and immutable event snapshots', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const repo = repository();
    await repo.checkIn(mutation(employeeId, deviceId));
    await database.insert(authSessions).values({
      id: '10000000-0000-4000-8000-000000000001',
      tokenHash: 'a'.repeat(64),
      actorType: 'employee',
      employeeId,
      createdAt: fixedNow,
      revokedAt: null,
    });
    const checkOutAt = new Date(fixedNow.getTime() + 481 * 60_000 + 59_999);

    const result = await repo.checkOut({
      ...mutation(employeeId, deviceId, checkOutAt),
      eventType: 'check_out',
    });

    expect(result).toMatchObject({
      kind: 'success',
      session: { workedMinutes: 481, overtimeMinutes: 1, shortageMinutes: 0 },
    });
    const events = await database.select().from(attendanceEvents).orderBy(asc(attendanceEvents.id));
    expect(events.map(({ eventType, source }) => ({ eventType, source }))).toEqual([
      { eventType: 'check_in', source: 'personal_device' },
      { eventType: 'check_out', source: 'personal_device' },
    ]);
    expect((await database.select().from(authSessions))[0]?.revokedAt).toEqual(fixedNow);
    const attendanceAudit = await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'employee_check_out'));
    expect(attendanceAudit[0]).toMatchObject({
      actorType: 'employee',
      actorIdentifier: String(employeeId),
      relatedIds: expect.objectContaining({
        employeeId: String(employeeId),
        sessionId: expect.any(String),
        eventId: expect.any(String),
        deviceId: String(deviceId),
      }),
      beforeState: expect.objectContaining({
        checkOutAt: null,
        workedMinutes: null,
        overtimeMinutes: null,
        shortageMinutes: null,
        automaticTimeoutAt: null,
        flagged: false,
      }),
    });
  });

  it('cannot leave a new login active when login races with checkout', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const attendance = repository();
    const sessions = createDrizzleAuthRepositories(database, () => fixedNow).sessions;
    await attendance.checkIn(mutation(employeeId, deviceId));

    const [loginResult, checkOutResult] = await Promise.all([
      sessions.createEmployeeIfCurrent({
        id: '20000000-0000-4000-8000-000000000002',
        tokenHash: 'b'.repeat(64),
        actorType: 'employee',
        employeeId,
        revokedAt: null,
      }, 3, () => Promise.resolve(true), (context) => attendance.hasOpenSession(employeeId, context)),
      attendance.checkOut({
        ...mutation(employeeId, deviceId, new Date(fixedNow.getTime() + 60_000)),
        eventType: 'check_out',
      }),
    ]);

    expect(['created', 'attendance_required']).toContain(loginResult);
    expect(checkOutResult.kind).toBe('success');
    expect((await database.select().from(authSessions)).every(({ revokedAt }) => revokedAt !== null)).toBe(true);
  });

  it('rejects session creation when the verified device was revoked before the locked recheck', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const attendance = repository();
    const sessions = createDrizzleAuthRepositories(database, () => fixedNow).sessions;
    const eligibility = createDeviceLoginEligibility();
    await attendance.checkIn(mutation(employeeId, deviceId));
    await createDrizzleDeviceRepository(database, () => fixedNow).revoke(deviceId);

    const result = await sessions.createEmployeeIfCurrent({
      id: '40000000-0000-4000-8000-000000000004',
      tokenHash: 'd'.repeat(64),
      actorType: 'employee',
      employeeId,
      revokedAt: null,
    }, 3, (context) => eligibility.isActiveEmployeeDevice(deviceId, employeeId, context),
    (context) => attendance.hasOpenSession(employeeId, context));

    expect(result).toBe('device_invalid');
    expect(await database.select().from(authSessions)).toHaveLength(0);
  });

  it('clears the without-permission mark when backdated attendance replaces the absence', async () => {
    const { branchId, employeeId } = await createFixtures();
    const absenceResult = await database.insert(attendanceDailyRecords).values({
      employeeId, branchId, attendanceDate: '2026-07-10', status: 'absence',
      absenceRequiredMinutes: 480, withoutPermissionAt: fixedNow,
      createdAt: fixedNow, updatedAt: fixedNow,
    });

    await expect(repository().manualCheckIn({
      employeeId, occurredAt: new Date('2026-07-10T07:00:00.000Z'),
    })).resolves.toMatchObject({ kind: 'success' });
    expect((await database.select().from(attendanceDailyRecords)
      .where(eq(attendanceDailyRecords.id, Number(absenceResult[0].insertId))))[0])
      .toMatchObject({ status: 'attendance_replaced', withoutPermissionAt: null });
  });

  it('replaces an automatic absence with backdated manual attendance but protects a day off', async () => {
    const { branchId, employeeId } = await createFixtures();
    const absenceResult = await database.insert(attendanceDailyRecords).values({
      employeeId,
      branchId,
      attendanceDate: '2026-07-10',
      status: 'absence',
      absenceRequiredMinutes: 480,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });
    await database.insert(attendanceDailyRecords).values({
      employeeId,
      branchId,
      attendanceDate: '2026-07-11',
      status: 'weekly_day_off',
      absenceRequiredMinutes: 480,
      dayOffConvertedAt: fixedNow,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });
    const repo = repository();

    const created = await repo.manualCheckIn({
      employeeId,
      occurredAt: new Date('2026-07-10T07:00:00.000Z'),
    });
    expect(created).toMatchObject({ kind: 'success' });
    expect((await database.select().from(attendanceDailyRecords)
      .where(eq(attendanceDailyRecords.id, Number(absenceResult[0].insertId))))[0])
      .toMatchObject({
        status: 'attendance_replaced',
        replacedBySessionId: expect.any(Number),
        replacedAt: fixedNow,
      });
    const replacementAudit = await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'replace_absence'));
    expect(replacementAudit[0]).toMatchObject({
      beforeState: expect.objectContaining({ status: 'absence' }),
      afterState: expect.objectContaining({ status: 'attendance_replaced' }),
      relatedIds: expect.objectContaining({
        dailyRecordId: String(Number(absenceResult[0].insertId)),
        sessionId: expect.any(String),
      }),
    });
    await expect(repo.manualCheckIn({
      employeeId,
      occurredAt: new Date('2026-07-11T07:00:00.000Z'),
    })).resolves.toEqual({ kind: 'weekly_day_off' });
  });

  it('approves a denied event at its original timestamp and immediately times out an old check-in', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const repo = repository();
    const occurredAt = new Date('2026-07-19T06:00:00.000Z');
    const attempt = await repo.recordDeniedAttempt({
      eventType: 'check_in',
      claimedEmployeeCode: 42,
      employeeId,
      source: 'personal_device',
      deviceId,
      occurredAt,
      latitude: 30.0444,
      longitude: 31.2357,
      gpsAccuracyMeters: 8,
      distanceMeters: 0,
      branchLatitude: 30.0444,
      branchLongitude: 31.2357,
      branchRadiusMeters: 150,
      failureReason: 'DEVICE_INVALID',
      suspicious: true,
    });
    await database.insert(authSessions).values({
      id: '30000000-0000-4000-8000-000000000003',
      tokenHash: 'c'.repeat(64),
      actorType: 'employee',
      employeeId,
      createdAt: fixedNow,
      revokedAt: null,
    });

    const result = await repo.approveDeniedAttempt(attempt.id);

    expect(result).toMatchObject({
      kind: 'success',
      session: {
        checkInAt: occurredAt,
        checkOutAt: new Date(occurredAt.getTime() + 16 * 60 * 60_000),
        workedMinutes: 960,
        flagged: true,
      },
    });
    expect((await database.select().from(attendanceDeniedAttempts)
      .where(eq(attendanceDeniedAttempts.id, attempt.id)))[0])
      .toMatchObject({ approvedAt: fixedNow, approvedSessionId: expect.any(Number) });
    expect((await database.select().from(authSessions))[0]?.revokedAt).toEqual(fixedNow);
    const timeoutAudit = await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'automatic_timeout'));
    expect(timeoutAudit[0]).toMatchObject({
      actorType: 'system',
      actorIdentifier: 'system',
      relatedIds: expect.objectContaining({ sessionId: expect.any(String), eventId: expect.any(String) }),
    });
  });

  it('refuses a manual check-in dated inside an inactive rehire gap', async () => {
    const { employeeId } = await createFixtures();
    const repo = repository();
    await database.insert(employeeEmploymentPeriods).values([
      {
        employeeId,
        activeFrom: new Date('2026-07-01T09:00:00.000Z'),
        activeTo: new Date('2026-07-05T09:00:00.000Z'),
        createdAt: new Date('2026-07-01T09:00:00.000Z'),
      },
      {
        employeeId,
        activeFrom: new Date('2026-07-15T09:00:00.000Z'),
        activeTo: null,
        createdAt: new Date('2026-07-15T09:00:00.000Z'),
      },
    ]);

    await expect(repo.manualCheckIn({
      employeeId,
      occurredAt: new Date('2026-07-10T07:00:00.000Z'),
    })).resolves.toEqual({ kind: 'employment_inactive' });
    expect(await database.select().from(attendanceSessions)).toEqual([]);

    // A date inside a real employment period still works.
    await expect(repo.manualCheckIn({
      employeeId,
      occurredAt: new Date('2026-07-16T07:00:00.000Z'),
    })).resolves.toMatchObject({ kind: 'success' });
  });

  it('runs a deferred deactivation when the employee finally checks out', async () => {
    const { employeeId } = await createFixtures();
    const applied: { employeeId: number; at: Date }[] = [];
    const repo = createDrizzleAttendanceRepository(database, {
      now: () => fixedNow,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: () => Promise.resolve(480),
      afterSessionClosed: async (id, at) => { applied.push({ employeeId: id, at }); },
    });
    await repo.manualCheckIn({ employeeId, occurredAt: new Date('2026-07-20T06:00:00.000Z') });

    await repo.manualCheckOut({ employeeId, occurredAt: new Date('2026-07-20T08:00:00.000Z') });

    expect(applied).toEqual([
      { employeeId, at: new Date('2026-07-20T08:00:00.000Z') },
    ]);
  });

  it('reports a deactivated employee as inactive employment rather than bad credentials', async () => {
    const { employeeId } = await createFixtures();
    const repo = repository();
    await database.update(employees).set({ employmentStatus: 'inactive' })
      .where(eq(employees.id, employeeId));

    await expect(repo.manualCheckIn({
      employeeId,
      occurredAt: new Date('2026-07-19T07:00:00.000Z'),
    })).resolves.toEqual({ kind: 'employment_inactive' });
  });

  it('allows correction only for automatic timeout and preserves its original value', async () => {
    const { employeeId } = await createFixtures();
    const repo = repository();
    const checkInAt = new Date('2026-07-19T06:00:00.000Z');
    const created = await repo.manualCheckIn({ employeeId, occurredAt: checkInAt });
    expect(created.kind).toBe('success');
    if (created.kind !== 'success') return;
    const originalTimeout = new Date(checkInAt.getTime() + 16 * 60 * 60_000);
    const correctedAt = new Date(checkInAt.getTime() + 8 * 60 * 60_000);

    const corrected = await repo.correctAutomaticTimeout(created.session.id, correctedAt);

    expect(corrected).toMatchObject({
      kind: 'success',
      session: {
        checkOutAt: correctedAt,
        automaticTimeoutAt: originalTimeout,
        automaticTimeoutCorrectedAt: fixedNow,
        workedMinutes: 480,
      },
    });
    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'attendance')).orderBy(asc(auditEvents.id));
    expect(events.map(({ action }) => action)).toEqual(expect.arrayContaining([
      'manual_check_in', 'automatic_timeout', 'correct_automatic_timeout',
    ]));
  });

  it('rejects a timeout correction beyond the sixteen-hour maximum session length', async () => {
    const { employeeId } = await createFixtures();
    const repo = repository();
    const checkInAt = new Date('2026-07-19T06:00:00.000Z');
    const created = await repo.manualCheckIn({ employeeId, occurredAt: checkInAt });
    expect(created.kind).toBe('success');
    if (created.kind !== 'success') return;
    const maximum = new Date(checkInAt.getTime() + 16 * 60 * 60_000);

    await expect(repo.correctAutomaticTimeout(created.session.id, new Date(maximum.getTime() + 60_000)))
      .resolves.toEqual({ kind: 'invalid_time' });

    expect((await database.select().from(attendanceSessions))[0]).toMatchObject({
      checkOutAt: maximum,
      automaticTimeoutCorrectedAt: null,
      workedMinutes: 960,
    });
    // The boundary itself stays correctable.
    await expect(repo.correctAutomaticTimeout(created.session.id, maximum))
      .resolves.toMatchObject({ kind: 'success', session: { workedMinutes: 960 } });
  });

  it('enforces the exact timeout when checkout arrives after a delayed worker deadline', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const apiRepository = repository();
    const checkedIn = await apiRepository.checkIn(mutation(employeeId, deviceId));
    expect(checkedIn.kind).toBe('success');
    if (checkedIn.kind !== 'success') return;
    const timeoutAt = new Date(fixedNow.getTime() + 16 * 60 * 60_000);
    const delayedNow = new Date(timeoutAt.getTime() + 60_000);
    const delayedRepository = createDrizzleAttendanceRepository(database, {
      now: () => delayedNow,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: () => Promise.resolve(480),
    });

    await expect(delayedRepository.manualCheckOut({
      employeeId,
      occurredAt: delayedNow,
    })).resolves.toMatchObject({
      kind: 'success',
      session: {
        checkOutAt: timeoutAt,
        automaticTimeoutAt: timeoutAt,
        workedMinutes: 960,
        flagged: true,
      },
    });
    expect((await database.select().from(attendanceEvents)
      .orderBy(asc(attendanceEvents.id))).at(-1)).toMatchObject({
      eventType: 'check_out',
      source: 'automatic_timeout',
      occurredAt: timeoutAt,
    });
  });

  it('does not treat an overdue unprocessed session as active attendance', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const checkedIn = await repository().checkIn(mutation(employeeId, deviceId));
    expect(checkedIn.kind).toBe('success');
    const overdueRepository = createDrizzleAttendanceRepository(database, {
      now: () => new Date(fixedNow.getTime() + 16 * 60 * 60_000),
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: () => Promise.resolve(480),
    });

    await expect(overdueRepository.hasOpenSession(employeeId)).resolves.toBe(false);
    await expect(overdueRepository.hasAnyOpenSession(employeeId)).resolves.toBe(true);
  });

});
