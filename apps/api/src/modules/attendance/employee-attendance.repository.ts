import { and, desc, eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  attendanceBlockedAttempts,
  attendanceSessions,
  branches,
  employeeDeviceRegistrations,
  employees,
  monthLocks,
  permissionAbsences,
  weeklyDayOffAssignments
} from "../../db";
import {
  type AttendanceBlockedAttemptRecord,
  type AttendanceSessionRecord,
  formatDateOnly,
  mapAttendanceSessionRecord,
  mapBlockedAttemptRecord
} from "./attendance-mappers";

type DatabaseSchema = typeof import("../../db/schema");
type Db = MySql2Database<DatabaseSchema>;

export async function findEmployeeById(db: Db, employeeId: number) {
  const rows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      branchId: employees.branchId,
      softDeletedAt: employees.softDeletedAt
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  return rows[0] ? {
    id: rows[0].id,
    fullName: rows[0].fullName,
    branchId: rows[0].branchId ?? null,
    softDeletedAt: rows[0].softDeletedAt ?? null
  } : null;
}

export async function findBranchById(db: Db, branchId: number) {
  const rows = await db
    .select({
      id: branches.id,
      setupStatus: branches.setupStatus,
      gpsLatitude: branches.gpsLatitude,
      gpsLongitude: branches.gpsLongitude,
      gpsRadiusMeters: branches.gpsRadiusMeters,
      allowedIpCidr: branches.allowedIpCidr,
      registeredDeviceToken: branches.registeredDeviceToken
    })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);

  return rows[0] ? {
    id: rows[0].id,
    setupStatus: rows[0].setupStatus,
    gpsLatitude: rows[0].gpsLatitude,
    gpsLongitude: rows[0].gpsLongitude,
    gpsRadiusMeters: rows[0].gpsRadiusMeters,
    allowedIpCidr: rows[0].allowedIpCidr,
    registeredDeviceToken: rows[0].registeredDeviceToken ?? null
  } : null;
}

export async function findActiveEmployeeDeviceFingerprint(db: Db, employeeId: number) {
  const rows = await db
    .select({
      browserFingerprint: employeeDeviceRegistrations.browserFingerprint
    })
    .from(employeeDeviceRegistrations)
    .where(
      and(
        eq(employeeDeviceRegistrations.employeeId, employeeId),
        eq(employeeDeviceRegistrations.status, "active")
      )
    )
    .orderBy(desc(employeeDeviceRegistrations.id))
    .limit(1);

  return rows[0]?.browserFingerprint ?? null;
}

export async function findOpenSession(db: Db, employeeId: number) {
  const rows = await db
    .select()
    .from(attendanceSessions)
    .where(
      and(
        eq(attendanceSessions.employeeId, employeeId),
        eq(attendanceSessions.status, "open")
      )
    )
    .orderBy(desc(attendanceSessions.id))
    .limit(1);

  return rows[0] ? mapAttendanceSessionRecord(rows[0]) : null;
}

export async function listEmployeeSessions(db: Db, employeeId: number) {
  const rows = await db
    .select()
    .from(attendanceSessions)
    .where(eq(attendanceSessions.employeeId, employeeId))
    .orderBy(attendanceSessions.checkInAtUtc);

  return rows.map(mapAttendanceSessionRecord);
}

export async function createSession(db: Db, input: {
  employeeId: number;
  branchId: number;
  checkInAtUtc: Date;
  checkInLatitude: number;
  checkInLongitude: number;
  checkInIpAddress: string;
  deviceId: string;
  branchPolicySnapshot: Record<string, unknown>;
}): Promise<AttendanceSessionRecord> {
  const result = await db.insert(attendanceSessions).values({
    employeeId: input.employeeId,
    branchId: input.branchId,
    status: "open",
    checkInAtUtc: input.checkInAtUtc,
    checkInLatitude: input.checkInLatitude.toFixed(7),
    checkInLongitude: input.checkInLongitude.toFixed(7),
    checkInIpAddress: input.checkInIpAddress,
    deviceId: input.deviceId,
    branchPolicySnapshot: input.branchPolicySnapshot
  });

  const rows = await db
    .select()
    .from(attendanceSessions)
    .where(eq(attendanceSessions.id, Number(result[0].insertId)))
    .limit(1);

  return mapAttendanceSessionRecord(rows[0]!);
}

export async function completeSession(db: Db, sessionId: number, checkOutAtUtc: Date) {
  await db
    .update(attendanceSessions)
    .set({
      status: "completed",
      checkOutAtUtc
    })
    .where(
      and(
        eq(attendanceSessions.id, sessionId),
        eq(attendanceSessions.status, "open")
      )
    );

  const rows = await db
    .select()
    .from(attendanceSessions)
    .where(eq(attendanceSessions.id, sessionId))
    .limit(1);

  return rows[0] ? mapAttendanceSessionRecord(rows[0]) : null;
}

export async function createBlockedAttempt(db: Db, input: {
  employeeId: number;
  branchId: number | null;
  attemptedAction: "check_in" | "check_out";
  failureReasons: string[];
  latitude: number;
  longitude: number;
  ipAddress: string;
  deviceId: string;
  branchPolicySnapshot: Record<string, unknown>;
  occurredAtUtc: Date;
}): Promise<AttendanceBlockedAttemptRecord> {
  const result = await db.insert(attendanceBlockedAttempts).values({
    employeeId: input.employeeId,
    branchId: input.branchId,
    attemptedAction: input.attemptedAction,
    failureReasons: input.failureReasons,
    latitude: input.latitude.toFixed(7),
    longitude: input.longitude.toFixed(7),
    ipAddress: input.ipAddress,
    deviceId: input.deviceId,
    branchPolicySnapshot: input.branchPolicySnapshot,
    occurredAtUtc: input.occurredAtUtc
  });

  const rows = await db
    .select()
    .from(attendanceBlockedAttempts)
    .where(eq(attendanceBlockedAttempts.id, Number(result[0].insertId)))
    .limit(1);

  return mapBlockedAttemptRecord(rows[0]!);
}

export async function hasWeeklyDayOff(db: Db, employeeId: number, dateKey: string) {
  const rows = await db
    .select({ dayOffDate: weeklyDayOffAssignments.dayOffDate })
    .from(weeklyDayOffAssignments)
    .where(eq(weeklyDayOffAssignments.employeeId, employeeId));

  return rows.some((row) => formatDateOnly(row.dayOffDate) === dateKey);
}

export async function hasPermissionAbsence(db: Db, employeeId: number, dateKey: string) {
  const rows = await db
    .select({ absenceDate: permissionAbsences.absenceDate })
    .from(permissionAbsences)
    .where(eq(permissionAbsences.employeeId, employeeId));

  return rows.some((row) => formatDateOnly(row.absenceDate) === dateKey);
}

export async function isMonthLocked(db: Db, monthKey: string) {
  const rows = await db
    .select({ id: monthLocks.id })
    .from(monthLocks)
    .where(eq(monthLocks.monthKey, monthKey))
    .limit(1);

  return Boolean(rows[0]);
}
