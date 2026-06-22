import type { attendanceBlockedAttempts, attendanceSessions } from "../../db";

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
  adminReason?: string | null;
  createdByAdminId?: number | null;
  updatedByAdminId?: number | null;
};

export type AdminAttendanceRecord = AttendanceSessionRecord & {
  employeeName: string;
  adminReason: string | null;
  createdByAdminId: number | null;
  updatedByAdminId: number | null;
};

export type AttendanceBlockedAttemptRecord = {
  id: number;
  employeeId: number;
  branchId: number | null;
  attemptedAction: "check_in" | "check_out";
  failureReasons: string[];
  latitude: number | null;
  longitude: number | null;
  ipAddress: string | null;
  deviceId: string | null;
  branchPolicySnapshot: Record<string, unknown>;
  occurredAtUtc: Date;
};

export function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function mapAttendanceSessionRecord(
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
    branchPolicySnapshot: (row.branchPolicySnapshot as Record<string, unknown>) ?? {},
    adminReason: row.adminReason ?? null,
    createdByAdminId: row.createdByAdminId ?? null,
    updatedByAdminId: row.updatedByAdminId ?? null
  };
}

export function mapBlockedAttemptRecord(
  row: typeof attendanceBlockedAttempts.$inferSelect
): AttendanceBlockedAttemptRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    branchId: row.branchId ?? null,
    attemptedAction: row.attemptedAction,
    failureReasons: Array.isArray(row.failureReasons) ? row.failureReasons as string[] : [],
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    ipAddress: row.ipAddress ?? null,
    deviceId: row.deviceId ?? null,
    branchPolicySnapshot: (row.branchPolicySnapshot as Record<string, unknown>) ?? {},
    occurredAtUtc: row.occurredAtUtc
  };
}
