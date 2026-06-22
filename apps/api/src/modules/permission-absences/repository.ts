import { and, eq, gte, lte } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  attendanceSessions,
  employees,
  monthLocks,
  permissionAbsences
} from "../../db";

type DatabaseSchema = typeof import("../../db/schema");

export type PermissionAbsenceRecord = {
  id: number;
  employeeId: number;
  absenceDate: string;
  permissionType: "generic";
  reason: string | null;
  createdByAdminId: number;
  updatedByAdminId: number | null;
};

type CreateDrizzlePermissionAbsenceRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function mapAbsenceRecord(
  row: typeof permissionAbsences.$inferSelect
): PermissionAbsenceRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    absenceDate: formatDateOnly(row.absenceDate),
    permissionType: "generic",
    reason: row.reason ?? null,
    createdByAdminId: row.createdByAdminId,
    updatedByAdminId: row.updatedByAdminId ?? null
  };
}

export function createDrizzlePermissionAbsenceRepository(
  options: CreateDrizzlePermissionAbsenceRepositoryOptions
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

    async listAbsences(employeeId: number, monthKey?: string) {
      const rows = await options.db
        .select()
        .from(permissionAbsences)
        .where(eq(permissionAbsences.employeeId, employeeId));

      return rows
        .map(mapAbsenceRecord)
        .filter((absence) => !monthKey || absence.absenceDate.startsWith(monthKey));
    },

    async findAbsenceById(absenceId: number) {
      const rows = await options.db
        .select()
        .from(permissionAbsences)
        .where(eq(permissionAbsences.id, absenceId))
        .limit(1);

      return rows[0] ? mapAbsenceRecord(rows[0]) : null;
    },

    async hasAttendanceOnDate(employeeId: number, absenceDate: string) {
      const start = new Date(`${absenceDate}T00:00:00.000Z`);
      const end = new Date(`${absenceDate}T23:59:59.999Z`);
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

    async createAbsence(input: {
      employeeId: number;
      absenceDate: string;
      createdByAdminId: number;
    }) {
      const result = await options.db.insert(permissionAbsences).values({
        employeeId: input.employeeId,
        absenceDate: parseDateOnly(input.absenceDate),
        createdByAdminId: input.createdByAdminId
      });

      const rows = await options.db
        .select()
        .from(permissionAbsences)
        .where(eq(permissionAbsences.id, Number(result[0].insertId)))
        .limit(1);

      if (!rows[0]) {
        throw new Error("Failed to load permission absence after create");
      }

      return mapAbsenceRecord(rows[0]);
    },

    async updateAbsence(absenceId: number, input: {
      absenceDate: string;
      updatedByAdminId: number;
    }) {
      await options.db
        .update(permissionAbsences)
        .set({
          absenceDate: parseDateOnly(input.absenceDate),
          updatedByAdminId: input.updatedByAdminId
        })
        .where(eq(permissionAbsences.id, absenceId));

      const rows = await options.db
        .select()
        .from(permissionAbsences)
        .where(eq(permissionAbsences.id, absenceId))
        .limit(1);

      return rows[0] ? mapAbsenceRecord(rows[0]) : null;
    }
  };
}
