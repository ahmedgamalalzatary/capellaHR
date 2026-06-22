import { describe, expect, it } from "vitest";
import type { AuditLogListFilterInput } from "@capella/shared";
import { createAuditLogService } from "../../../../src/modules/audit-logs/service";
import type {
  AuditLogRecord,
  AuditLogRepository
} from "../../../../src/modules/audit-logs/service";

class InMemoryAuditLogRepository implements AuditLogRepository {
  logs: AuditLogRecord[] = [];
  nextId = 1;

  async listAuditLogs(filters: AuditLogListFilterInput) {
    const filtered = this.logs.filter((log) => {
      if (filters.entityType && log.entityType !== filters.entityType) {
        return false;
      }

      if (filters.actionType && log.actionType !== filters.actionType) {
        return false;
      }

      if (filters.search && !`${log.entityDisplayName ?? ""} ${log.entityId}`.toLowerCase().includes(filters.search.toLowerCase())) {
        return false;
      }

      if (filters.dateFrom && log.occurredAtUtc.slice(0, 10) < filters.dateFrom) {
        return false;
      }

      if (filters.dateTo && log.occurredAtUtc.slice(0, 10) > filters.dateTo) {
        return false;
      }

      return true;
    });

    const offset = (filters.page - 1) * filters.pageSize;

    return {
      items: filtered.slice(offset, offset + filters.pageSize),
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / filters.pageSize))
      }
    };
  }

  async createAuditLog(input: {
    adminId: number;
    actionType: string;
    entityType: string;
    entityId: string;
    entityDisplayName?: string;
    reason?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    occurredAtUtc: Date;
  }) {
    const record: AuditLogRecord = {
      id: this.nextId++,
      adminId: input.adminId,
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId,
      entityDisplayName: input.entityDisplayName ?? null,
      reason: input.reason ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      occurredAtUtc: input.occurredAtUtc.toISOString()
    };

    this.logs.push(record);
    return record;
  }
}

describe("audit log service", () => {
  it("records audit log entries", async () => {
    const repository = new InMemoryAuditLogRepository();
    const service = createAuditLogService({ repository });

    const result = await service.recordAuditLog({
      adminId: 1,
      actionType: "create",
      entityType: "attendance",
      entityId: "42",
      entityDisplayName: "Ahmed Gamal",
      reason: "manual correction",
      before: null,
      after: { status: "completed" }
    });

    expect(result.entityType).toBe("attendance");
    expect(result.reason).toBe("manual correction");
  });

  it("filters audit logs", async () => {
    const repository = new InMemoryAuditLogRepository();
    repository.logs.push({
      id: 1,
      adminId: 1,
      actionType: "create",
      entityType: "attendance",
      entityId: "42",
      entityDisplayName: "Ahmed Gamal",
      reason: "manual correction",
      before: null,
      after: { status: "completed" },
      occurredAtUtc: "2026-06-22T08:00:00.000Z"
    });
    repository.logs.push({
      id: 2,
      adminId: 1,
      actionType: "update",
      entityType: "employee",
      entityId: "7",
      entityDisplayName: "Mina Adel",
      reason: null,
      before: null,
      after: { branchId: 2 },
      occurredAtUtc: "2026-06-23T08:00:00.000Z"
    });
    const service = createAuditLogService({ repository });

    const result = await service.listAuditLogs({
      page: 1,
      pageSize: 10,
      entityType: "attendance",
      actionType: "create"
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.entityId).toBe("42");
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1
    });
  });
});
