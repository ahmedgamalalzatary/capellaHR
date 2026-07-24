import { attendanceJobs, attendanceSessions, employees } from '@capella/database/schema';
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import { calendarDateInTimeZone } from '../weekly-day-off/index.js';
import { endOfDate, nextCalendarDate } from './attendance-calendar.js';
import {
  findJob,
  lockEmployee,
  writeJobAudit,
  type Database,
  type Transaction,
} from './attendance-repository-support.js';
import { type AttendanceSessionWriter } from './attendance-session-writer.js';
import type { AttendanceJobRepository } from './attendance-jobs.js';

const RETRY_BACKOFF_BASE_MS = 60_000;
const RETRY_BACKOFF_MAX_MS = 15 * 60_000;

/** Bounded exponential backoff so a repeatedly failing job cannot be reclaimed immediately. */
const retryRunAt = (failedAt: Date, attemptCount: number) => new Date(
  failedAt.getTime()
  + Math.min(RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, attemptCount - 1), RETRY_BACKOFF_MAX_MS),
);

export const createAttendanceJobsRepository = (
  database: Database,
  writer: AttendanceSessionWriter,
  options: { now: () => Date; timeZone: string },
): AttendanceJobRepository & {
  reconcileDueAbsencesForEmployee: (
    employeeId: number,
    previousRequiredMinutes: number,
    context: Transaction,
  ) => Promise<number>;
} => {
  const { now, timeZone } = options;

  return {
    async findMissingAbsenceScheduleStart(throughDate) {
      const firstScheduledDate = (await database.select({
        attendanceDate: attendanceJobs.attendanceDate,
      }).from(attendanceJobs).where(eq(attendanceJobs.jobType, 'absence_generation'))
        .orderBy(asc(attendanceJobs.attendanceDate)).limit(1))[0]?.attendanceDate;
      const startDate = firstScheduledDate && firstScheduledDate < throughDate
        ? firstScheduledDate
        : throughDate;
      const scheduled = await database.select({ attendanceDate: attendanceJobs.attendanceDate })
        .from(attendanceJobs).where(and(
          eq(attendanceJobs.jobType, 'absence_generation'),
          gte(attendanceJobs.attendanceDate, startDate),
          lte(attendanceJobs.attendanceDate, throughDate),
        ));
      const scheduledDates = new Set(scheduled.map(({ attendanceDate }) => attendanceDate));
      let candidate = startDate;
      while (candidate <= throughDate) {
        if (!scheduledDates.has(candidate)) return candidate;
        const [year, month, day] = candidate.split('-').map(Number) as [number, number, number];
        candidate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
      }
      return null;
    },

    ensureAbsenceJob(attendanceDate, runAt) {
      return database.transaction(async (transaction) => {
        const createdAt = now();
        const inserted = await transaction.insert(attendanceJobs).values({
          jobType: 'absence_generation',
          sessionId: null,
          attendanceDate,
          status: 'scheduled',
          runAt,
          attemptCount: 0,
          lastError: null,
          startedAt: null,
          completedAt: null,
          createdAt,
          updatedAt: createdAt,
        }).onDuplicateKeyUpdate({ set: { id: sql`${attendanceJobs.id}` } });
        const scheduled = (await transaction.select().from(attendanceJobs).where(and(
          eq(attendanceJobs.jobType, 'absence_generation'),
          eq(attendanceJobs.attendanceDate, attendanceDate),
        )).limit(1))[0];
        if (!scheduled) throw new Error('Scheduled absence job disappeared');
        if (inserted[0].affectedRows === 1 && Number(inserted[0].insertId) === scheduled.id) {
          await writeJobAudit(transaction, 'job_schedule', null, scheduled, createdAt);
        }
        return scheduled;
      });
    },

    claimNext() {
      return database.transaction(async (transaction) => {
        const claimedAt = now();
        const due = (await transaction.select().from(attendanceJobs).where(and(
          eq(attendanceJobs.status, 'scheduled'),
          lte(attendanceJobs.runAt, claimedAt),
        )).orderBy(asc(attendanceJobs.runAt), asc(attendanceJobs.id))
          .for('update').limit(1))[0];
        if (!due) return null;
        await transaction.update(attendanceJobs).set({
          status: 'processing',
          attemptCount: sql`${attendanceJobs.attemptCount} + 1`,
          startedAt: claimedAt,
          completedAt: null,
          updatedAt: claimedAt,
        }).where(and(
          eq(attendanceJobs.id, due.id),
          eq(attendanceJobs.status, 'scheduled'),
        ));
        const claimed = await findJob(transaction, due.id);
        if (!claimed) throw new Error('Claimed attendance job disappeared');
        await writeJobAudit(transaction, 'job_claim', due, claimed, claimedAt);
        return claimed;
      });
    },

    processAutomaticTimeout(sessionId) {
      return database.transaction(async (transaction) => {
        const target = (await transaction.select({ employeeId: attendanceSessions.employeeId })
          .from(attendanceSessions).where(eq(attendanceSessions.id, sessionId)).limit(1))[0];
        if (!target) throw new Error('Attendance session for timeout job does not exist');
        const employee = await lockEmployee(transaction, target.employeeId);
        if (!employee) throw new Error('Employee for timeout job does not exist');
        const session = (await transaction.select({
          id: attendanceSessions.id,
          employeeId: attendanceSessions.employeeId,
          attendanceDate: attendanceSessions.attendanceDate,
          requiredMinutes: attendanceSessions.requiredMinutes,
          checkInAt: attendanceSessions.checkInAt,
          checkOutAt: attendanceSessions.checkOutAt,
        }).from(attendanceSessions).where(and(
          eq(attendanceSessions.id, sessionId),
          eq(attendanceSessions.employeeId, target.employeeId),
        )).for('update').limit(1))[0];
        if (!session) throw new Error('Attendance session for timeout job disappeared');
        if (session.checkOutAt) return;
        const timeoutAt = new Date(session.checkInAt.getTime() + 16 * 60 * 60_000);
        if (timeoutAt.getTime() > now().getTime()) throw new Error('Attendance timeout job is not due');
        const result = await writer.closeSession(transaction, session, timeoutAt, {
          source: 'automatic_timeout',
          deviceId: null,
          latitude: null,
          longitude: null,
          gpsAccuracyMeters: null,
          distanceMeters: null,
          branchLatitude: employee.branchLatitude,
          branchLongitude: employee.branchLongitude,
          branchRadiusMeters: employee.branchRadiusMeters,
          approvedDeniedAttemptId: null,
        }, true);
        if (result.kind !== 'success') {
          throw new Error(`Automatic timeout could not complete: ${result.kind}`);
        }
      });
    },

    async generateAbsences(attendanceDate) {
      if (endOfDate(attendanceDate, timeZone).getTime() >= now().getTime()) {
        throw new Error('Absence generation date has not ended');
      }
      const candidates = await database.select({ id: employees.id }).from(employees)
        .where(isNull(employees.deletedAt));
      let createdCount = 0;
      for (const candidate of candidates) {
        createdCount += await database.transaction((transaction) => (
          writer.createAbsenceForEmployee(transaction, candidate.id, attendanceDate)
        ));
      }
      return createdCount;
    },

    async reconcileDueAbsencesForEmployee(employeeId, previousRequiredMinutes, context) {
      const rolloutDate = (await context.select({ attendanceDate: attendanceJobs.attendanceDate })
        .from(attendanceJobs)
        .where(eq(attendanceJobs.jobType, 'absence_generation'))
        .orderBy(asc(attendanceJobs.attendanceDate))
        .limit(1))[0]?.attendanceDate;
      if (rolloutDate === undefined || rolloutDate === null) return 0;

      const currentDate = calendarDateInTimeZone(now(), timeZone);
      let createdCount = 0;
      for (
        let attendanceDate = rolloutDate;
        attendanceDate < currentDate;
        attendanceDate = nextCalendarDate(attendanceDate)
      ) {
        createdCount += await writer.createAbsenceForEmployee(
          context,
          employeeId,
          attendanceDate,
          previousRequiredMinutes,
        );
      }
      return createdCount;
    },

    complete(id) {
      return database.transaction(async (transaction) => {
        const completedAt = now();
        const before = (await transaction.select().from(attendanceJobs)
          .where(eq(attendanceJobs.id, id)).for('update').limit(1))[0];
        if (!before || before.status === 'completed') return;
        await transaction.update(attendanceJobs).set({
          status: 'completed',
          completedAt,
          updatedAt: completedAt,
        }).where(eq(attendanceJobs.id, id));
        const after = await findJob(transaction, id);
        if (!after) throw new Error('Completed attendance job disappeared');
        await writeJobAudit(transaction, 'job_complete', before, after, completedAt);
      });
    },

    fail(id, reason) {
      return database.transaction(async (transaction) => {
        const failedAt = now();
        const before = (await transaction.select().from(attendanceJobs)
          .where(eq(attendanceJobs.id, id)).for('update').limit(1))[0];
        if (!before || before.status !== 'processing') return;
        const status = before.attemptCount >= 3 ? 'failed' as const : 'scheduled' as const;
        await transaction.update(attendanceJobs).set({
          status,
          lastError: reason.slice(0, 1000),
          // A retry keeps its past runAt without a backoff, so the worker would spin on it.
          ...(status === 'scheduled'
            ? { startedAt: null, runAt: retryRunAt(failedAt, before.attemptCount) }
            : {}),
          updatedAt: failedAt,
        }).where(eq(attendanceJobs.id, id));
        const after = await findJob(transaction, id);
        if (!after) throw new Error('Failed attendance job disappeared');
        await writeJobAudit(
          transaction,
          status === 'failed' ? 'job_failed' : 'job_retry',
          before,
          after,
          failedAt,
        );
      });
    },

    recoverStale(staleBefore) {
      return database.transaction(async (transaction) => {
        const recoveredAt = now();
        const stale = await transaction.select().from(attendanceJobs).where(and(
          eq(attendanceJobs.status, 'processing'),
          lte(attendanceJobs.startedAt, staleBefore),
        )).for('update');
        for (const job of stale) {
          const status = job.attemptCount >= 3 ? 'failed' as const : 'scheduled' as const;
          await transaction.update(attendanceJobs).set({
            status,
            lastError: 'WORKER_INTERRUPTED',
            ...(status === 'scheduled' ? { startedAt: null } : {}),
            updatedAt: recoveredAt,
          }).where(eq(attendanceJobs.id, job.id));
          const recovered = await findJob(transaction, job.id);
          if (!recovered) throw new Error('Recovered attendance job disappeared');
          await writeJobAudit(transaction, 'job_recover', job, recovered, recoveredAt);
        }
        return stale.length;
      });
    },

    reconcileFailed() {
      return database.transaction(async (transaction) => {
        const reconciledAt = now();
        const failed = await transaction.select().from(attendanceJobs)
          .where(eq(attendanceJobs.status, 'failed')).for('update');
        for (const job of failed) {
          await transaction.update(attendanceJobs).set({
            status: 'scheduled',
            runAt: reconciledAt,
            startedAt: null,
            completedAt: null,
            updatedAt: reconciledAt,
          }).where(eq(attendanceJobs.id, job.id));
          const reconciled = await findJob(transaction, job.id);
          if (!reconciled) throw new Error('Reconciled attendance job disappeared');
          await writeJobAudit(transaction, 'job_reconcile', job, reconciled, reconciledAt);
        }
        return failed.length;
      });
    },
  };
};
