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

type DatabaseSchema = typeof import("../../db/schema");

export type AttendanceSessionRecord = {
  id: number;
  employeeId: number;
  branchId: number;
  status: "open" | "completed";
  checkInAtUtc: Date;
  checkOutAtUtc: Date | null;
  checkInLatitude: number;
  checkInLongitude: number;
  checkInIpAddress: string;
  deviceId: string;
  branchPolicySnapshot: Record<string, unknown>;
};

export type AttendanceBlockedAttemptRecord = {
  id: number;
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
};

type CreateDrizzleAttendanceRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

function mapAttendanceSessionRecord(
  row: typeof attendanceSessions.$inferSelect
): AttendanceSessionRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    branchId: row.branchId,
    status: row.status,
    checkInAtUtc: row.checkInAtUtc,
    checkOutAtUtc: row.checkOutAtUtc ?? null,
    checkInLatitude: Number(row.checkInLatitude),
    checkInLongitude: Number(row.checkInLongitude),
    checkInIpAddress: row.checkInIpAddress,
    deviceId: row.deviceId,
    branchPolicySnapshot: (row.branchPolicySnapshot as Record<string, unknown>) ?? {}
  };
}

function mapBlockedAttemptRecord(
  row: typeof attendanceBlockedAttempts.$inferSelect
): AttendanceBlockedAttemptRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    branchId: row.branchId ?? null,
    attemptedAction: row.attemptedAction,
    failureReasons: Array.isArray(row.failureReasons) ? row.failureReasons as string[] : [],
    latitude: row.latitude === null ? 0 : Number(row.latitude),
    longitude: row.longitude === null ? 0 : Number(row.longitude),
    ipAddress: row.ipAddress ?? "",
    deviceId: row.deviceId ?? "",
    branchPolicySnapshot: (row.branchPolicySnapshot as Record<string, unknown>) ?? {},
    occurredAtUtc: row.occurredAtUtc
  };
}

export function createDrizzleAttendanceRepository(
  options: CreateDrizzleAttendanceRepositoryOptions
) {
  return {
    async findEmployeeById(employeeId: number) {
      const rows = await options.db
        .select({
          id: employees.id,
          branchId: employees.branchId,
          softDeletedAt: employees.softDeletedAt
        })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      return rows[0] ? {
        id: rows[0].id,
        branchId: rows[0].branchId ?? null,
        softDeletedAt: rows[0].softDeletedAt ?? null
      } : null;
    },

    async findBranchById(branchId: number) {
      const rows = await options.db
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
    },

    async findActiveEmployeeDeviceFingerprint(employeeId: number) {
      const rows = await options.db
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
    },

    async findOpenSession(employeeId: number) {
      const rows = await options.db
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
    },

    async listEmployeeSessions(employeeId: number) {
      const rows = await options.db
        .select()
        .from(attendanceSessions)
        .where(eq(attendanceSessions.employeeId, employeeId))
        .orderBy(attendanceSessions.checkInAtUtc);

      return rows.map(mapAttendanceSessionRecord);
    },

    async createSession(input: {
      employeeId: number;
      branchId: number;
      checkInAtUtc: Date;
      checkInLatitude: number;
      checkInLongitude: number;
      checkInIpAddress: string;
      deviceId: string;
      branchPolicySnapshot: Record<string, unknown>;
    }) {
      const result = await options.db.insert(attendanceSessions).values({
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

      const rows = await options.db
        .select()
        .from(attendanceSessions)
        .where(eq(attendanceSessions.id, Number(result[0].insertId)))
        .limit(1);

      return mapAttendanceSessionRecord(rows[0]!);
    },

    async completeSession(sessionId: number, checkOutAtUtc: Date) {
      await options.db
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

      const rows = await options.db
        .select()
        .from(attendanceSessions)
        .where(eq(attendanceSessions.id, sessionId))
        .limit(1);

      return rows[0] ? mapAttendanceSessionRecord(rows[0]) : null;
    },

    async createBlockedAttempt(input: {
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
    }) {
      const result = await options.db.insert(attendanceBlockedAttempts).values({
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

      const rows = await options.db
        .select()
        .from(attendanceBlockedAttempts)
        .where(eq(attendanceBlockedAttempts.id, Number(result[0].insertId)))
        .limit(1);

      return mapBlockedAttemptRecord(rows[0]!);
    },

    async hasWeeklyDayOff(employeeId: number, dateKey: string) {
      const dayOffDate = parseDateKey(dateKey);
      const rows = await options.db
        .select({ id: weeklyDayOffAssignments.id })
        .from(weeklyDayOffAssignments)
        .where(
          and(
            eq(weeklyDayOffAssignments.employeeId, employeeId),
            eq(weeklyDayOffAssignments.dayOffDate, dayOffDate)
          )
        )
        .limit(1);

      return Boolean(rows[0]);
    },

    async hasPermissionAbsence(employeeId: number, dateKey: string) {
      const absenceDate = parseDateKey(dateKey);
      const rows = await options.db
        .select({ id: permissionAbsences.id })
        .from(permissionAbsences)
        .where(
          and(
            eq(permissionAbsences.employeeId, employeeId),
            eq(permissionAbsences.absenceDate, absenceDate)
          )
        )
        .limit(1);

      return Boolean(rows[0]);
    },

    async isMonthLocked(monthKey: string) {
      const rows = await options.db
        .select({ id: monthLocks.id })
        .from(monthLocks)
        .where(eq(monthLocks.monthKey, monthKey))
        .limit(1);

      return Boolean(rows[0]);
    }
  };
}

function parseDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}
