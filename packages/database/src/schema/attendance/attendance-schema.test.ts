import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import * as attendanceSchema from './index.js';

const {
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceEvents,
  attendanceJobs,
  attendanceSessions,
} = attendanceSchema as typeof attendanceSchema & Record<string, unknown>;

describe('attendance dashboard indexes', () => {
  it('supports date-first monthly attendance scans', () => {
    expect(getTableConfig(attendanceSessions).indexes.some((item) => item.config.name === 'attendance_sessions_date_employee_idx')).toBe(true);
    expect(getTableConfig(attendanceDailyRecords).indexes.some((item) => item.config.name === 'attendance_daily_records_date_employee_idx')).toBe(true);
  });
});

describe('attendance job schema', () => {
  it('stores durable scheduled jobs with retry and failure state', () => {
    expect(Object.keys(getTableColumns(attendanceJobs))).toEqual(expect.arrayContaining([
      'id', 'jobType', 'sessionId', 'attendanceDate', 'status', 'runAt',
      'attemptCount', 'lastError', 'startedAt', 'completedAt', 'createdAt', 'updatedAt',
    ]));

    const config = getTableConfig(attendanceJobs);
    expect(config.indexes.map(({ config: index }) => index.name)).toEqual(expect.arrayContaining([
      'attendance_jobs_session_unique',
      'attendance_jobs_absence_date_unique',
      'attendance_jobs_claim_idx',
    ]));
    expect(config.checks.map((constraint) => constraint.name)).toContain(
      'attendance_jobs_payload_state',
    );
  });
});

describe('attendance daily-record schema', () => {
  it('stores the absence snapshot and reversible weekly day-off state', () => {
    expect(Object.keys(getTableColumns(attendanceDailyRecords))).toEqual(expect.arrayContaining([
      'id', 'employeeId', 'attendanceDate', 'status', 'absenceRequiredMinutes',
      'dayOffConvertedAt', 'replacedBySessionId', 'replacedAt', 'createdAt', 'updatedAt',
    ]));
  });

  it('enforces one record per employee/date and a valid duration snapshot', () => {
    const config = getTableConfig(attendanceDailyRecords);
    expect(config.indexes.some((index) => (
      index.config.name === 'attendance_daily_records_employee_date_unique'
    ))).toBe(true);
    expect(config.checks.map((item) => item.name)).toContain(
      'attendance_daily_records_required_minutes_range',
    );
  });

  it('stores one immutable attendance session per employee and Cairo date', () => {
    expect(attendanceSessions).toBeDefined();
    const columns = getTableColumns(attendanceSessions);
    expect(Object.keys(columns)).toEqual(expect.arrayContaining([
      'id', 'employeeId', 'attendanceDate', 'requiredMinutes', 'checkInAt',
      'checkOutAt', 'openEmployeeId', 'workedMinutes', 'overtimeMinutes', 'shortageMinutes',
      'automaticTimeoutAt', 'automaticTimeoutCorrectedAt', 'flagged',
      'createdAt', 'updatedAt',
    ]));
    const config = getTableConfig(attendanceSessions);
    expect(config.indexes.some((index) => (
      index.config.name === 'attendance_sessions_employee_date_unique'
    ))).toBe(true);
    expect(config.indexes.some((index) => (
      index.config.name === 'attendance_sessions_open_employee_unique'
      && index.config.unique
    ))).toBe(true);
    expect(config.indexes.some((index) => (
      index.config.name === 'attendance_sessions_id_employee_date_unique'
      && index.config.unique
    ))).toBe(true);
  });

  it('stores accepted event verification snapshots separately from sessions', () => {
    expect(attendanceEvents).toBeDefined();
    expect(Object.keys(getTableColumns(attendanceEvents))).toEqual(expect.arrayContaining([
      'id', 'sessionId', 'employeeId', 'eventType', 'source', 'deviceId',
      'occurredAt', 'latitude', 'longitude', 'gpsAccuracyMeters',
      'distanceMeters', 'branchLatitude', 'branchLongitude',
      'branchRadiusMeters', 'approvedDeniedAttemptId', 'createdAt',
    ]));
    expect(getTableConfig(attendanceEvents).foreignKeys.map((foreignKey) => foreignKey.reference()))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        name: 'attendance_events_session_owner_fk',
        columns: [attendanceEvents.sessionId, attendanceEvents.employeeId],
      })]));
    expect(getTableConfig(attendanceEvents).foreignKeys.map((foreignKey) => foreignKey.reference()))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        name: 'attendance_events_approved_attempt_owner_fk',
        columns: [
          attendanceEvents.approvedDeniedAttemptId,
          attendanceEvents.employeeId,
          attendanceEvents.eventType,
        ],
      })]));
    expect(getTableConfig(attendanceEvents).checks.map(({ name }) => name))
      .toContain('attendance_events_approval_source_state');
  });

  it('retains denied and suspicious attempts with immutable approval linkage', () => {
    expect(attendanceDeniedAttempts).toBeDefined();
    expect(Object.keys(getTableColumns(attendanceDeniedAttempts))).toEqual(expect.arrayContaining([
      'id', 'eventType', 'claimedEmployeeCode', 'employeeId', 'source',
      'deviceId', 'occurredAt', 'failureReason', 'suspicious', 'approvedAt',
      'approvedSessionId', 'dismissedAt', 'createdAt',
    ]));
    expect(getTableConfig(attendanceDeniedAttempts).foreignKeys).toHaveLength(3);
    expect(getTableConfig(attendanceDeniedAttempts).indexes.some((index) => (
      index.config.name === 'attendance_denied_attempts_id_owner_type_unique'
      && index.config.unique
    ))).toBe(true);
    expect(getTableConfig(attendanceDeniedAttempts).foreignKeys.map((foreignKey) => foreignKey.reference()))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        name: 'attendance_denied_attempts_approved_owner_fk',
        columns: [attendanceDeniedAttempts.approvedSessionId, attendanceDeniedAttempts.employeeId],
      })]));
    expect(getTableConfig(attendanceDailyRecords).foreignKeys.map((foreignKey) => foreignKey.reference()))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        name: 'attendance_daily_records_replaced_owner_fk',
        columns: [
          attendanceDailyRecords.replacedBySessionId,
          attendanceDailyRecords.employeeId,
          attendanceDailyRecords.attendanceDate,
        ],
      })]));
  });
});
