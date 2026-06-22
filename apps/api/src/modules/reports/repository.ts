import { and, eq, gte, isNull, lt, or } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  attendanceSessions,
  branches,
  employeeBranchAssignments,
  employees,
  permissionAbsences,
  weeklyDayOffAssignments
} from "../../db";

type DatabaseSchema = typeof import("../../db/schema");

type CreateDrizzleReportsRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

function getMonthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Invalid month "${month}": expected format YYYY-MM`);
  }

  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    throw new Error(`Invalid month "${month}": month must be between 01 and 12`);
  }

  const monthIndex = monthNumber - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));

  return { start, end };
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function createDrizzleReportsRepository(options: CreateDrizzleReportsRepositoryOptions) {
  return {
    async listEmployees(filters: { employeeId?: number }) {
      const rows = await options.db
        .select({
          id: employees.id,
          fullName: employees.fullName,
          branchId: employees.branchId,
          branchName: branches.name
        })
        .from(employees)
        .leftJoin(branches, eq(branches.id, employees.branchId))
        .where(filters.employeeId ? eq(employees.id, filters.employeeId) : undefined);

      return rows;
    },

    async listCompletedAttendanceDates(employeeId: number, month: string) {
      const { start, end } = getMonthRange(month);
      const rows = await options.db
        .select({
          checkInAtUtc: attendanceSessions.checkInAtUtc,
          branchId: attendanceSessions.branchId,
          branchName: branches.name
        })
        .from(attendanceSessions)
        .innerJoin(branches, eq(branches.id, attendanceSessions.branchId))
        .where(
          and(
            eq(attendanceSessions.employeeId, employeeId),
            eq(attendanceSessions.status, "completed"),
            gte(attendanceSessions.checkInAtUtc, start),
            lt(attendanceSessions.checkInAtUtc, end)
          )
        )
        .orderBy(attendanceSessions.checkInAtUtc);

      return rows.map((row) => ({
        date: formatDateOnly(row.checkInAtUtc),
        branchId: row.branchId,
        branchName: row.branchName
      }));
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
    },

    async listBranchAssignments(employeeId: number, month: string) {
      const { start, end } = getMonthRange(month);
      const rows = await options.db
        .select({
          branchId: employeeBranchAssignments.branchId,
          branchName: branches.name,
          effectiveFrom: employeeBranchAssignments.effectiveFrom,
          effectiveTo: employeeBranchAssignments.effectiveTo
        })
        .from(employeeBranchAssignments)
        .innerJoin(branches, eq(branches.id, employeeBranchAssignments.branchId))
        .where(and(
          eq(employeeBranchAssignments.employeeId, employeeId),
          lt(employeeBranchAssignments.effectiveFrom, end),
          or(
            isNull(employeeBranchAssignments.effectiveTo),
            gte(employeeBranchAssignments.effectiveTo, start)
          )
        ))
        .orderBy(employeeBranchAssignments.effectiveFrom);

      return rows.map((row) => ({
        branchId: row.branchId,
        branchName: row.branchName,
        effectiveFrom: row.effectiveFrom.toISOString(),
        effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null
      }));
    }
  };
}
