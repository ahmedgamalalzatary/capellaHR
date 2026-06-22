import { and, asc, desc, eq, gte, like, lte, type SQL } from "drizzle-orm";
import type { AttendanceListFilterInput } from "@capella/shared";
import { attendanceSessions, employees } from "../../db";
import {
  type AdminAttendanceRecord,
  mapAttendanceSessionRecord
} from "./attendance-mappers";

export function buildAdminAttendanceConditions(filters: AttendanceListFilterInput): SQL[] {
  const conditions: SQL[] = [];

  if (filters.employeeName) {
    conditions.push(like(employees.fullName, `%${filters.employeeName}%`));
  }

  if (filters.branchId) {
    conditions.push(eq(attendanceSessions.branchId, filters.branchId));
  }

  if (filters.status) {
    conditions.push(eq(attendanceSessions.status, filters.status));
  }

  if (filters.dateFrom) {
    conditions.push(gte(attendanceSessions.checkInAtUtc, new Date(`${filters.dateFrom}T00:00:00.000Z`)));
  }

  if (filters.dateTo) {
    conditions.push(lte(attendanceSessions.checkInAtUtc, new Date(`${filters.dateTo}T23:59:59.999Z`)));
  }

  return conditions;
}

export function buildAdminAttendanceWhere(filters: AttendanceListFilterInput): SQL | undefined {
  const conditions = buildAdminAttendanceConditions(filters);

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function buildAdminAttendanceOrderBy(filters: AttendanceListFilterInput): SQL {
  if (filters.sortBy === "employee_name") {
    return filters.sortDirection === "asc" ? asc(employees.fullName) : desc(employees.fullName);
  }

  return filters.sortDirection === "asc"
    ? asc(attendanceSessions.checkInAtUtc)
    : desc(attendanceSessions.checkInAtUtc);
}

export function mapAdminAttendanceRow(
  session: typeof attendanceSessions.$inferSelect,
  employeeName: string
): AdminAttendanceRecord {
  return {
    ...mapAttendanceSessionRecord(session),
    employeeName,
    adminReason: session.adminReason ?? null,
    createdByAdminId: session.createdByAdminId ?? null,
    updatedByAdminId: session.updatedByAdminId ?? null
  } satisfies AdminAttendanceRecord;
}
