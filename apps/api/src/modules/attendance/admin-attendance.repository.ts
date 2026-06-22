import { count, eq } from "drizzle-orm";
import type { AttendanceListFilterInput } from "@capella/shared";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { attendanceSessions, employees } from "../../db";
import type { AdminAttendanceRecord } from "./attendance-mappers";
import {
  buildAdminAttendanceOrderBy,
  buildAdminAttendanceWhere,
  mapAdminAttendanceRow
} from "./attendance-query-helpers";

type DatabaseSchema = typeof import("../../db/schema");
type Db = MySql2Database<DatabaseSchema>;

export async function listAdminAttendance(db: Db, filters: AttendanceListFilterInput) {
  const where = buildAdminAttendanceWhere(filters);
  const offset = (filters.page - 1) * filters.pageSize;
  const rows = await db
    .select({
      session: attendanceSessions,
      employeeName: employees.fullName
    })
    .from(attendanceSessions)
    .innerJoin(employees, eq(attendanceSessions.employeeId, employees.id))
    .where(where)
    .orderBy(buildAdminAttendanceOrderBy(filters))
    .limit(filters.pageSize)
    .offset(offset);
  const totalRows = await db
    .select({ value: count() })
    .from(attendanceSessions)
    .innerJoin(employees, eq(attendanceSessions.employeeId, employees.id))
    .where(where);
  const total = Number(totalRows[0]?.value ?? 0);

  return {
    items: rows.map(({ session, employeeName }) => mapAdminAttendanceRow(session, employeeName)),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize))
    }
  };
}

export async function findAdminAttendanceById(db: Db, sessionId: number): Promise<AdminAttendanceRecord | null> {
  const rows = await db
    .select({
      session: attendanceSessions,
      employeeName: employees.fullName
    })
    .from(attendanceSessions)
    .innerJoin(employees, eq(attendanceSessions.employeeId, employees.id))
    .where(eq(attendanceSessions.id, sessionId))
    .limit(1);

  const row = rows[0];

  if (!row) {
    return null;
  }

  return mapAdminAttendanceRow(row.session, row.employeeName);
}

export async function createAdminAttendance(db: Db, input: {
  employeeId: number;
  branchId: number;
  checkInAtUtc: Date;
  checkOutAtUtc: Date | null;
  reason: string;
  adminId: number;
}) {
  const result = await db.insert(attendanceSessions).values({
    employeeId: input.employeeId,
    branchId: input.branchId,
    status: input.checkOutAtUtc ? "completed" : "open",
    checkInAtUtc: input.checkInAtUtc,
    checkOutAtUtc: input.checkOutAtUtc,
    checkInLatitude: "0.0000000",
    checkInLongitude: "0.0000000",
    checkInIpAddress: "",
    deviceId: "admin",
    branchPolicySnapshot: {},
    adminReason: input.reason,
    createdByAdminId: input.adminId
  });

  const record = await findAdminAttendanceById(db, Number(result[0].insertId));
  if (!record) {
    throw new Error("Failed to retrieve newly created attendance record");
  }
  return record;
}

export async function updateAdminAttendance(db: Db, sessionId: number, input: {
  branchId: number;
  checkInAtUtc: Date;
  checkOutAtUtc: Date | null;
  reason: string;
  adminId: number;
}) {
  await db
    .update(attendanceSessions)
    .set({
      branchId: input.branchId,
      status: input.checkOutAtUtc ? "completed" : "open",
      checkInAtUtc: input.checkInAtUtc,
      checkOutAtUtc: input.checkOutAtUtc,
      adminReason: input.reason,
      updatedByAdminId: input.adminId
    })
    .where(eq(attendanceSessions.id, sessionId));

  return findAdminAttendanceById(db, sessionId);
}

export async function deleteAdminAttendance(db: Db, sessionId: number) {
  const result = await db
    .delete(attendanceSessions)
    .where(eq(attendanceSessions.id, sessionId));

  return result[0].affectedRows > 0;
}
