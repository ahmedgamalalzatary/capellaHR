import { and, eq, gte, lt } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { attendanceSessions, monthLocks } from "../../db";
import type { MonthLockListFilterInput } from "@capella/shared";
import type { MonthLockRecord } from "./types";

type DatabaseSchema = typeof import("../../db/schema");

type CreateDrizzleMonthLockRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

function toMonthLockRecord(row: typeof monthLocks.$inferSelect): MonthLockRecord {
  return {
    id: row.id,
    monthKey: row.monthKey,
    lockedAt: row.lockedAt.toISOString(),
    lockedByAdminId: row.lockedByAdminId,
    notes: row.notes ?? null
  };
}

export function createDrizzleMonthLockRepository(
  options: CreateDrizzleMonthLockRepositoryOptions
) {
  return {
    async listMonthLocks(filters: MonthLockListFilterInput) {
      const rows = await options.db.select().from(monthLocks);

      return rows
        .map(toMonthLockRecord)
        .filter((lock) => !filters.monthKey || lock.monthKey === filters.monthKey)
        .sort((left, right) => right.monthKey.localeCompare(left.monthKey));
    },

    async findMonthLockByMonthKey(monthKey: string) {
      const rows = await options.db
        .select()
        .from(monthLocks)
        .where(eq(monthLocks.monthKey, monthKey))
        .limit(1);

      return rows[0] ? toMonthLockRecord(rows[0]) : null;
    },

    async hasOpenSessions(monthKey: string) {
      if (!/^\d{4}-\d{2}$/.test(monthKey)) {
        throw new Error("Invalid month key format");
      }

      const monthStart = new Date(`${monthKey}-01T00:00:00.000Z`);
      const [year, month] = monthKey.split("-").map(Number);

      if (Number.isNaN(year) || Number.isNaN(month)) {
        throw new Error("Invalid month key format");
      }

      const nextMonthStart = new Date(Date.UTC(year!, month!, 1));
      const rows = await options.db
        .select({ id: attendanceSessions.id })
        .from(attendanceSessions)
        .where(and(
          eq(attendanceSessions.status, "open"),
          gte(attendanceSessions.checkInAtUtc, monthStart),
          lt(attendanceSessions.checkInAtUtc, nextMonthStart)
        ))
        .limit(1);

      return Boolean(rows[0]);
    },

    async createMonthLock(input: {
      monthKey: string;
      lockedByAdminId: number;
      notes?: string;
    }) {
      const result = await options.db.insert(monthLocks).values({
        monthKey: input.monthKey,
        lockedAt: new Date(),
        lockedByAdminId: input.lockedByAdminId,
        notes: input.notes
      });

      const rows = await options.db
        .select()
        .from(monthLocks)
        .where(eq(monthLocks.id, Number(result[0].insertId)))
        .limit(1);

      if (!rows[0]) {
        throw new Error("Failed to load month lock after create");
      }

      return toMonthLockRecord(rows[0]);
    }
  };
}
