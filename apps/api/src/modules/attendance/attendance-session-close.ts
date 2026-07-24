import {
  attendanceEvents,
  attendanceJobs,
  attendanceSessions,
  authSessions,
} from '@capella/database/schema';
import { and, eq, isNull } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import {
  actorFor,
  attendanceRelatedIds,
  findJob,
  findSession,
  writeJobAudit,
  type AttendanceFinancialLockCheck,
  type EventSnapshot,
  type Transaction,
} from './attendance-repository-support.js';
import {
  calculateAttendanceMinutes,
  type AttendanceMutationResult,
} from './attendance-service.js';

export const createAttendanceSessionCloser = (options: {
  now: () => Date;
  isFinanciallyLocked: AttendanceFinancialLockCheck;
}) => {
  const { now, isFinanciallyLocked } = options;

  const insertEvent = async (
    transaction: Transaction,
    input: EventSnapshot & {
      sessionId: number;
      employeeId: number;
      eventType: 'check_in' | 'check_out';
      occurredAt: Date;
      source: EventSnapshot['source'] | 'automatic_timeout';
    },
  ) => {
    const inserted = await transaction.insert(attendanceEvents).values({ ...input, createdAt: now() });
    return Number(inserted[0].insertId);
  };

  const closeSession = async (
    transaction: Transaction,
    session: {
      id: number;
      employeeId: number;
      attendanceDate: string;
      requiredMinutes: number;
      checkInAt: Date;
    },
    occurredAt: Date,
    snapshot: EventSnapshot & { source: EventSnapshot['source'] | 'automatic_timeout' },
    automatic: boolean,
  ): Promise<AttendanceMutationResult> => {
    const timeoutAt = new Date(session.checkInAt.getTime() + 16 * 60 * 60_000);
    if (!automatic && occurredAt.getTime() >= timeoutAt.getTime()) {
      return closeSession(transaction, session, timeoutAt, {
        source: 'automatic_timeout',
        deviceId: null,
        latitude: null,
        longitude: null,
        gpsAccuracyMeters: null,
        distanceMeters: null,
        branchLatitude: snapshot.branchLatitude,
        branchLongitude: snapshot.branchLongitude,
        branchRadiusMeters: snapshot.branchRadiusMeters,
        approvedDeniedAttemptId: null,
      }, true);
    }
    const before = await findSession(transaction, session.id);
    if (!before) throw new Error('Attendance session disappeared before check-out');
    if (occurredAt.getTime() <= session.checkInAt.getTime()) return { kind: 'invalid_time' };
    if (await isFinanciallyLocked(session.employeeId, session.attendanceDate, transaction)) {
      return { kind: 'financially_locked' };
    }
    const minutes = calculateAttendanceMinutes(
      session.checkInAt,
      occurredAt,
      session.requiredMinutes,
    );
    const changedAt = now();
    await transaction.update(attendanceSessions).set({
      checkOutAt: occurredAt,
      ...minutes,
      ...(automatic ? { automaticTimeoutAt: occurredAt, flagged: true } : {}),
      updatedAt: changedAt,
    }).where(and(
      eq(attendanceSessions.id, session.id),
      isNull(attendanceSessions.checkOutAt),
    ));
    if (!automatic) {
      const scheduledJob = (await transaction.select().from(attendanceJobs).where(and(
        eq(attendanceJobs.sessionId, session.id),
        eq(attendanceJobs.status, 'scheduled'),
      )).for('update').limit(1))[0];
      await transaction.update(attendanceJobs).set({
        status: 'completed',
        completedAt: changedAt,
        updatedAt: changedAt,
      }).where(and(
        eq(attendanceJobs.sessionId, session.id),
        eq(attendanceJobs.status, 'scheduled'),
      ));
      if (scheduledJob) {
        const completedJob = await findJob(transaction, scheduledJob.id);
        if (!completedJob) throw new Error('Completed attendance job disappeared');
        await writeJobAudit(
          transaction,
          'job_cancel_timeout',
          scheduledJob,
          completedJob,
          changedAt,
        );
      }
    }
    const eventId = await insertEvent(transaction, {
      ...snapshot,
      sessionId: session.id,
      employeeId: session.employeeId,
      eventType: 'check_out',
      occurredAt,
    });
    const auditActor = actorFor(snapshot.source, session.employeeId);
    const activeSessions = await transaction.select({ id: authSessions.id })
      .from(authSessions).where(and(
        eq(authSessions.employeeId, session.employeeId),
        isNull(authSessions.revokedAt),
      )).for('update');
    await transaction.update(authSessions).set({ revokedAt: changedAt }).where(and(
      eq(authSessions.employeeId, session.employeeId),
      isNull(authSessions.revokedAt),
    ));
    for (const activeSession of activeSessions) {
      await writeAudit(transaction, {
        ...(auditActor ? { actor: auditActor } : {}),
        module: 'auth',
        action: 'session_revoke',
        entityType: 'session',
        entityId: activeSession.id,
        relatedIds: { employeeId: session.employeeId },
        createdAt: changedAt,
      });
    }
    const updated = await findSession(transaction, session.id);
    if (!updated) throw new Error('Attendance session disappeared during check-out');
    await writeAudit(transaction, {
      ...(auditActor ? { actor: auditActor } : {}),
      module: 'attendance',
      action: automatic ? 'automatic_timeout' : snapshot.source === 'admin_manual'
        ? 'manual_check_out' : snapshot.source === 'admin_approved_denied'
          ? 'approve_denied_check_out' : 'employee_check_out',
      entityType: 'attendance_session',
      entityId: session.id,
      beforeState: before,
      afterState: updated,
      relatedIds: attendanceRelatedIds(session.employeeId, session.id, eventId, snapshot.deviceId),
      createdAt: changedAt,
    });
    return { kind: 'success', session: updated };
  };

  return { insertEvent, closeSession };
};
