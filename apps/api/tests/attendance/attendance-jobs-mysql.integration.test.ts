import {
  attendanceDailyRecords,
  attendanceEvents,
  attendanceJobs,
  attendanceSessions,
  auditEvents,
  authSessions,
  employeeEmploymentPeriods,
  employees,
} from '@capella/database/schema';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDrizzleAttendanceRepository } from '../../src/modules/attendance/attendance-repository.js';
import { createAttendanceJobProcessor } from '../../src/modules/attendance/attendance-jobs.js';
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

const repositoryAt = (instant: Date) => createDrizzleAttendanceRepository(database, {
  now: () => instant,
  timeZone: 'Africa/Cairo',
  isFinanciallyLocked: () => Promise.resolve(false),
  readRequiredDuration: () => Promise.resolve(480),
});

describe('MySQL-backed attendance jobs and absences', () => {
  it('finds the earliest missing durable absence date after worker downtime', async () => {
    await createFixtures();
    const repo = repository();
    await repo.ensureAbsenceJob('2026-07-01', new Date('2026-07-01T21:00:00.000Z'));
    await repo.ensureAbsenceJob('2026-07-03', new Date('2026-07-03T21:00:00.000Z'));

    await expect(repo.findMissingAbsenceScheduleStart('2026-07-03'))
      .resolves.toBe('2026-07-02');
    await repo.ensureAbsenceJob('2026-07-02', new Date('2026-07-02T21:00:00.000Z'));
    await expect(repo.findMissingAbsenceScheduleStart('2026-07-03'))
      .resolves.toBeNull();
  });

  it('initializes a new absence schedule at the rollout date instead of employee history', async () => {
    await createFixtures();
    const repo = repository();

    await expect(repo.findMissingAbsenceScheduleStart('2026-07-20'))
      .resolves.toBe('2026-07-20');
  });

  it('persists the exact timeout schedule atomically and resolves it on ordinary checkout', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const repo = repository();

    const checkedIn = await repo.checkIn(mutation(employeeId, deviceId));

    expect(checkedIn.kind).toBe('success');
    const scheduled = (await database.select().from(attendanceJobs))[0];
    expect(scheduled).toMatchObject({
      jobType: 'automatic_timeout',
      status: 'scheduled',
      runAt: new Date(fixedNow.getTime() + 16 * 60 * 60_000),
      attemptCount: 0,
    });

    await repo.manualCheckOut({
      employeeId,
      occurredAt: new Date(fixedNow.getTime() + 60 * 60_000),
    });

    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'completed', completedAt: fixedNow });
    expect((await database.select().from(auditEvents)
      .where(eq(auditEvents.entityType, 'attendance_job'))).map(({ action }) => action))
      .toEqual(expect.arrayContaining(['job_schedule', 'job_cancel_timeout']));
  });

  it('executes a due timeout at check-in plus exactly 16 hours and remains idempotent', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const apiRepository = repository();
    const checkedIn = await apiRepository.checkIn(mutation(employeeId, deviceId));
    expect(checkedIn.kind).toBe('success');
    if (checkedIn.kind !== 'success') return;
    await database.insert(authSessions).values({
      id: '30000000-0000-4000-8000-000000000004',
      tokenHash: 'd'.repeat(64),
      actorType: 'employee',
      employeeId,
      createdAt: fixedNow,
      revokedAt: null,
    });
    const timeoutAt = new Date(fixedNow.getTime() + 16 * 60 * 60_000);
    const workerRepository = createDrizzleAttendanceRepository(database, {
      now: () => timeoutAt,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: () => Promise.resolve(480),
    });
    const processor = createAttendanceJobProcessor(workerRepository);

    await expect(processor.processNext()).resolves.toMatchObject({
      jobType: 'automatic_timeout',
      sessionId: checkedIn.session.id,
    });
    await expect(workerRepository.processAutomaticTimeout(checkedIn.session.id)).resolves.toBeUndefined();

    expect((await database.select().from(attendanceSessions))[0]).toMatchObject({
      checkOutAt: timeoutAt,
      automaticTimeoutAt: timeoutAt,
      workedMinutes: 960,
      flagged: true,
    });
    expect((await database.select().from(attendanceEvents))).toHaveLength(2);
    expect((await database.select().from(authSessions))[0]?.revokedAt).toEqual(timeoutAt);
    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'completed', completedAt: timeoutAt, attemptCount: 1 });
    expect((await database.select().from(auditEvents)
      .where(eq(auditEvents.entityType, 'attendance_job'))).map(({ action }) => action))
      .toEqual(expect.arrayContaining(['job_schedule', 'job_claim', 'job_complete']));
  });

  it('does not accrue an absence on the day an employee was deactivated', async () => {
    const { branchId, employeeId } = await createFixtures();
    await database.insert(employees).values({
      employeeCode: 45,
      fullName: 'موظف تم تعطيله في اليوم',
      personalPhone: '01000000045',
      whatsappPhone: '01000000045',
      pinHash: 'hash', credentialVersion: 1, age: 30, address: 'القاهرة', branchId,
      shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00',
      employmentStatus: 'inactive', deletedAt: null,
      createdAt: new Date('2026-07-01T08:00:00.000Z'), updatedAt: fixedNow,
    });
    const deactivated = (await database.select({ id: employees.id }).from(employees)
      .where(eq(employees.employeeCode, 45)))[0]!.id;
    await database.insert(employeeEmploymentPeriods).values({
      employeeId: deactivated,
      activeFrom: new Date('2026-07-01T08:00:00.000Z'),
      activeTo: new Date('2026-07-19T14:00:00.000Z'),
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
    });

    await repository().generateAbsences('2026-07-19');

    // The still-employed fixture employee is absent; the deactivated one must not be, or the
    // deduction would reopen a balance that deactivation already settled.
    const records = await database.select().from(attendanceDailyRecords);
    expect(records.map(({ employeeId: id }) => id)).toEqual([employeeId]);
  });

  it('includes activation and deactivation dates when generating absences and remains idempotent', async () => {
    const { branchId, employeeId } = await createFixtures();
    await database.insert(employees).values([
      {
        employeeCode: 43,
        fullName: 'موظف تم إنشاؤه في اليوم',
        personalPhone: '01000000043',
        whatsappPhone: '01000000043',
        pinHash: 'hash', credentialVersion: 1, age: 30, address: 'القاهرة', branchId,
        shiftDurationMinutes: 420, monthlyBaseSalary: '5000.00', deletedAt: null,
        createdAt: new Date('2026-07-19T08:00:00.000Z'), updatedAt: fixedNow,
      },
      {
        employeeCode: 44,
        fullName: 'موظف تم حذفه في اليوم',
        personalPhone: '01000000044',
        whatsappPhone: '01000000044',
        pinHash: 'hash', credentialVersion: 1, age: 30, address: 'القاهرة', branchId,
        shiftDurationMinutes: 360, monthlyBaseSalary: '5000.00',
        deletedAt: new Date('2026-07-19T08:00:00.000Z'),
        createdAt: new Date('2026-07-01T08:00:00.000Z'), updatedAt: fixedNow,
      },
    ]);
    const repo = repository();
    const idOfCode = async (employeeCode: number) => (await database.select({ id: employees.id })
      .from(employees).where(eq(employees.employeeCode, employeeCode)))[0]!.id;
    const activatedOnTheDay = await idOfCode(43);
    const deactivatedOnTheDay = await idOfCode(44);

    await expect(repo.generateAbsences('2026-07-19')).resolves.toBe(2);
    await expect(repo.generateAbsences('2026-07-19')).resolves.toBe(0);

    const records = await database.select().from(attendanceDailyRecords);
    // The employee activated that day is covered; the one deactivated that day is
    // already excluded as a candidate, so exactly two records exist.
    expect(records.map(({ employeeId: id }) => id).sort()).toEqual([employeeId, activatedOnTheDay].sort());
    expect(records.map(({ employeeId: id }) => id)).not.toContain(deactivatedOnTheDay);
    for (const record of records) {
      expect(record).toMatchObject({
        attendanceDate: '2026-07-19',
        status: 'absence',
        absenceRequiredMinutes: 480,
      });
    }
    expect((await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'automatic_absence')))[0]).toMatchObject({
      actorType: 'system',
      actorIdentifier: 'system',
      relatedIds: expect.objectContaining({ employeeId: String(employeeId) }),
    });
  });

  it('holds a retried job behind an attempt-scaled backoff before it can be reclaimed', async () => {
    await createFixtures();
    const repo = repository();
    await repo.ensureAbsenceJob('2026-07-19', new Date('2026-07-19T21:00:00.000Z'));

    const claimed = await repo.claimNext();
    expect(claimed?.attemptCount).toBe(1);
    await repo.fail(claimed!.id, 'ABSENCE_GENERATION_FAILED');

    const retried = (await database.select().from(attendanceJobs))[0];
    expect(retried).toMatchObject({
      status: 'scheduled',
      attemptCount: 1,
      startedAt: null,
      lastError: 'ABSENCE_GENERATION_FAILED',
      runAt: new Date(fixedNow.getTime() + 60_000),
    });
    await expect(repo.claimNext()).resolves.toBeNull();
    await expect(repositoryAt(new Date(fixedNow.getTime() + 59_999)).claimNext())
      .resolves.toBeNull();

    await expect(repositoryAt(new Date(fixedNow.getTime() + 60_000)).claimNext())
      .resolves.toMatchObject({ status: 'processing', attemptCount: 2 });
  });

  it('marks a job failed after three attempts and makes it eligible for reconciliation', async () => {
    await createFixtures();
    const repo = repository();
    await repo.ensureAbsenceJob('2026-07-19', new Date('2026-07-19T21:00:00.000Z'));

    // Each retry is held behind a backoff, so the worker clock advances past it.
    let workerNow = fixedNow;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const worker = repositoryAt(workerNow);
      const claimed = await worker.claimNext();
      expect(claimed?.attemptCount).toBe(attempt + 1);
      await worker.fail(claimed!.id, 'ABSENCE_GENERATION_FAILED');
      workerNow = new Date(workerNow.getTime() + 60_000 * 2 ** attempt);
    }

    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'failed', attemptCount: 3, lastError: 'ABSENCE_GENERATION_FAILED' });
    await repo.reconcileFailed();
    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'scheduled', attemptCount: 3, runAt: fixedNow });
    const jobAudits = await database.select().from(auditEvents)
      .where(eq(auditEvents.entityType, 'attendance_job')).orderBy(asc(auditEvents.id));
    expect(jobAudits.map(({ action }) => action)).toEqual(expect.arrayContaining([
      'job_schedule', 'job_claim', 'job_retry', 'job_failed', 'job_reconcile',
    ]));
    expect(jobAudits.filter(({ action }) => action === 'job_retry'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ afterState: expect.objectContaining({ startedAt: null }) }),
      ]));
  });

  it('audits stale-job recovery using the exact persisted post-recovery state', async () => {
    await createFixtures();
    const repo = repository();
    await repo.ensureAbsenceJob('2026-07-19', new Date('2026-07-19T21:00:00.000Z'));
    await repo.claimNext();

    await expect(repo.recoverStale(fixedNow)).resolves.toBe(1);

    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'scheduled', startedAt: null, lastError: 'WORKER_INTERRUPTED' });
    expect((await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'job_recover')))[0]).toMatchObject({
      beforeState: expect.objectContaining({ status: 'processing', startedAt: fixedNow.toISOString() }),
      afterState: expect.objectContaining({ status: 'scheduled', startedAt: null }),
    });
  });

  it('atomically claims a due attendance job only once across concurrent workers', async () => {
    await createFixtures();
    const repo = repository();
    await repo.ensureAbsenceJob('2026-07-19', new Date('2026-07-19T21:00:00.000Z'));

    const claims = await Promise.all([repo.claimNext(), repo.claimNext()]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'processing', attemptCount: 1 });
  });

  it('schedules one absence job and one audit across concurrent worker startups', async () => {
    await createFixtures();
    const repo = repository();
    const runAt = new Date('2026-07-19T21:00:00.000Z');

    await expect(Promise.all([
      repo.ensureAbsenceJob('2026-07-19', runAt),
      repo.ensureAbsenceJob('2026-07-19', runAt),
    ])).resolves.toHaveLength(2);

    expect(await database.select().from(attendanceJobs)).toHaveLength(1);
    expect(await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'job_schedule'))).toHaveLength(1);
  });

  it('serializes automatic absence generation against a concurrent backdated check-in', async () => {
    const { employeeId } = await createFixtures();
    const repo = repository();
    const attendanceAt = new Date('2026-07-19T08:00:00.000Z');

    await Promise.all([
      repo.generateAbsences('2026-07-19'),
      repo.manualCheckIn({ employeeId, occurredAt: attendanceAt }),
    ]);

    expect(await database.select().from(attendanceSessions)).toHaveLength(1);
    const daily = await database.select().from(attendanceDailyRecords);
    expect(
      daily.length === 0 || (
        daily.length === 1
        && daily[0]?.status === 'attendance_replaced'
        && daily[0]?.replacedBySessionId !== null
      ),
    ).toBe(true);
  });
});
