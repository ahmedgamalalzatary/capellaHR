import { and, eq, gte, lt } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  attendanceSessions,
  branches,
  employees,
  permissionAbsences,
  weeklyDayOffAssignments
} from "../../db";

type DatabaseSchema = typeof import("../../db/schema");

type CreateDrizzleReportsRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

function getMonthRange(month: string) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));

  return { start, end };
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function createDrizzleReportsRepository(options: CreateDrizzleReportsRepositoryOptions) {
  return {
    async listEmployees(filters: { employeeId?: number; branchId?: number }) {
      const conditions = [];

      if (filters.employeeId) {
        conditions.push(eq(employees.id, filters.employeeId));
      }

      if (filters.branchId) {
        conditions.push(eq(employees.branchId, filters.branchId));
      }

      const rows = await options.db
        .select({
          id: employees.id,
          fullName: employees.fullName,
          branchId: employees.branchId,
          branchName: branches.name
        })
        .from(employees)
        .leftJoin(branches, eq(branches.id, employees.branchId))
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return rows;
    },

    async listCompletedAttendanceDates(employeeId: number, month: string) {
      const { start, end } = getMonthRange(month);
      const rows = await options.db
        .select({
          checkInAtUtc: attendanceSessions.checkInAtUtc
        })
        .from(attendanceSessions)
        .where(
          and(
            eq(attendanceSessions.employeeId, employeeId),
            eq(attendanceSessions.status, "completed"),
            gte(attendanceSessions.checkInAtUtc, start),
            lt(attendanceSessions.checkInAtUtc, end)
          )
        );

      return rows.map((row) => formatDateOnly(row.checkInAtUtc));
    },

    async listWeeklyDayOffDates(employeeId: number, month: string) {
      const { start, end } = getMonthRange(month);
      const rows = await options.db
        .select({
          dayOffDate: weeklyDayOffAssignments.dayOffDate
        })
        .from(weeklyDayOffAssignments)
        .where(
          and(
            eq(weeklyDayOffAssignments.employeeId, employeeId),
            gte(weeklyDayOffAssignments.dayOffDate, start),
            lt(weeklyDayOffAssignments.dayOffDate, end)
          )
        );

      return rows.map((row) => formatDateOnly(row.dayOffDate));
    },

    async listPermissionAbsenceDates(employeeId: number, month: string) {
      const { start, end } = getMonthRange(month);
      const rows = await options.db
        .select({
          absenceDate: permissionAbsences.absenceDate
        })
        .from(permissionAbsences)
        .where(
          and(
            eq(permissionAbsences.employeeId, employeeId),
            gte(permissionAbsences.absenceDate, start),
            lt(permissionAbsences.absenceDate, end)
          )
        );

      return rows.map((row) => formatDateOnly(row.absenceDate));
    }
  };
}
