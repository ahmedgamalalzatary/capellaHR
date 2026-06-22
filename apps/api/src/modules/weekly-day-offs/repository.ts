import { and, eq, gte, lte } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  attendanceSessions,
  employees,
  monthLocks,
  weeklyDayOffAssignments
} from "../../db";

type DatabaseSchema = typeof import("../../db/schema");

export type WeeklyDayOffAssignmentRecord = {
  id: number;
  employeeId: number;
  weekStartDate: string;
  dayOffDate: string;
  overrideReason: string | null;
  assignedByAdminId: number;
};

type CreateDrizzleWeeklyDayOffRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function mapAssignmentRecord(
  row: typeof weeklyDayOffAssignments.$inferSelect
): WeeklyDayOffAssignmentRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    weekStartDate: formatDateOnly(row.weekStartDate),
    dayOffDate: formatDateOnly(row.dayOffDate),
    overrideReason: row.overrideReason ?? null,
    assignedByAdminId: row.assignedByAdminId
  };
}

export function createDrizzleWeeklyDayOffRepository(
  options: CreateDrizzleWeeklyDayOffRepositoryOptions
) {
  return {
    async findEmployeeById(employeeId: number) {
      const rows = await options.db
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      return rows[0] ?? null;
    },

    async listAssignments(employeeId: number, weekStartDate?: string) {
      const rows = await options.db
        .select()
        .from(weeklyDayOffAssignments)
        .where(eq(weeklyDayOffAssignments.employeeId, employeeId));

      return rows
        .map(mapAssignmentRecord)
        .filter((assignment) => !weekStartDate || assignment.weekStartDate === weekStartDate);
    },

    async findAssignmentById(assignmentId: number) {
      const rows = await options.db
        .select()
        .from(weeklyDayOffAssignments)
        .where(eq(weeklyDayOffAssignments.id, assignmentId))
        .limit(1);

      return rows[0] ? mapAssignmentRecord(rows[0]) : null;
    },

    async hasAttendanceOnDate(employeeId: number, dayOffDate: string) {
      const start = new Date(`${dayOffDate}T00:00:00.000Z`);
      const end = new Date(`${dayOffDate}T23:59:59.999Z`);
      const rows = await options.db
        .select({ id: attendanceSessions.id })
        .from(attendanceSessions)
        .where(
          and(
            eq(attendanceSessions.employeeId, employeeId),
            gte(attendanceSessions.checkInAtUtc, start),
            lte(attendanceSessions.checkInAtUtc, end)
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
    },

    async createAssignment(input: {
      employeeId: number;
      weekStartDate: string;
      dayOffDate: string;
      overrideReason?: string;
      assignedByAdminId: number;
    }) {
      const result = await options.db.insert(weeklyDayOffAssignments).values({
        employeeId: input.employeeId,
        weekStartDate: parseDateOnly(input.weekStartDate),
        dayOffDate: parseDateOnly(input.dayOffDate),
        overrideReason: input.overrideReason,
        assignedByAdminId: input.assignedByAdminId
      });

      const rows = await options.db
        .select()
        .from(weeklyDayOffAssignments)
        .where(eq(weeklyDayOffAssignments.id, Number(result[0].insertId)))
        .limit(1);

      return mapAssignmentRecord(rows[0]!);
    },

    async updateAssignment(assignmentId: number, input: {
      weekStartDate: string;
      dayOffDate: string;
      overrideReason?: string;
    }) {
      await options.db
        .update(weeklyDayOffAssignments)
        .set({
          weekStartDate: parseDateOnly(input.weekStartDate),
          dayOffDate: parseDateOnly(input.dayOffDate),
          overrideReason: input.overrideReason
        })
        .where(eq(weeklyDayOffAssignments.id, assignmentId));

      const rows = await options.db
        .select()
        .from(weeklyDayOffAssignments)
        .where(eq(weeklyDayOffAssignments.id, assignmentId))
        .limit(1);

      return rows[0] ? mapAssignmentRecord(rows[0]) : null;
    }
  };
}
