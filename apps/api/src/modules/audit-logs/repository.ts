import { and, count, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { AuditLogListFilterInput } from "@capella/shared";
import { auditLogs } from "../../db";
import type { AuditLogRecord } from "./types";

type DatabaseSchema = typeof import("../../db/schema");

type CreateDrizzleAuditLogRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

function mapAuditLogRecord(row: typeof auditLogs.$inferSelect): AuditLogRecord {
  return {
    id: row.id,
    adminId: row.adminId,
    actionType: row.actionType,
    entityType: row.entityType,
    entityId: row.entityId,
    entityDisplayName: row.entityDisplayName ?? null,
    reason: row.reason ?? null,
    before: (row.beforeJson as Record<string, unknown> | null) ?? null,
    after: (row.afterJson as Record<string, unknown> | null) ?? null,
    occurredAtUtc: row.occurredAtUtc.toISOString()
  };
}

export function createDrizzleAuditLogRepository(options: CreateDrizzleAuditLogRepositoryOptions) {
  return {
    async listAuditLogs(filters: AuditLogListFilterInput) {
      const conditions = [];

      if (filters.entityType) {
        conditions.push(eq(auditLogs.entityType, filters.entityType));
      }

      if (filters.actionType) {
        conditions.push(eq(auditLogs.actionType, filters.actionType));
      }

      if (filters.dateFrom) {
        conditions.push(gte(auditLogs.occurredAtUtc, new Date(`${filters.dateFrom}T00:00:00.000Z`)));
      }

      if (filters.dateTo) {
        conditions.push(lte(auditLogs.occurredAtUtc, new Date(`${filters.dateTo}T23:59:59.999Z`)));
      }

      if (filters.search) {
        const pattern = `%${filters.search.toLowerCase()}%`;
        conditions.push(or(
          sql`LOWER(${auditLogs.entityDisplayName}) LIKE ${pattern}`,
          sql`LOWER(${auditLogs.entityId}) LIKE ${pattern}`
        )!);
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const offset = (filters.page - 1) * filters.pageSize;
      const rows = await options.db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.occurredAtUtc))
        .limit(filters.pageSize)
        .offset(offset);
      const totalRows = await options.db
        .select({ value: count() })
        .from(auditLogs)
        .where(where);
      const total = Number(totalRows[0]?.value ?? 0);

      return {
        items: rows.map(mapAuditLogRecord),
        pagination: {
          page: filters.page,
          pageSize: filters.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / filters.pageSize))
        }
      };
    },

    async createAuditLog(input: {
      adminId: number;
      actionType: string;
      entityType: string;
      entityId: string;
      entityDisplayName?: string;
      reason?: null | string;
      before?: null | Record<string, unknown>;
      after?: null | Record<string, unknown>;
      occurredAtUtc: Date;
    }) {
      const result = await options.db.insert(auditLogs).values({
        adminId: input.adminId,
        actionType: input.actionType,
        entityType: input.entityType,
        entityId: input.entityId,
        entityDisplayName: input.entityDisplayName,
        reason: input.reason,
        beforeJson: input.before,
        afterJson: input.after,
        occurredAtUtc: input.occurredAtUtc
      });

      const rows = await options.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.id, Number(result[0].insertId)))
        .limit(1);

      if (!rows[0]) {
        throw new Error("Failed to load audit log after create");
      }

      return mapAuditLogRecord(rows[0]);
    }
  };
}
