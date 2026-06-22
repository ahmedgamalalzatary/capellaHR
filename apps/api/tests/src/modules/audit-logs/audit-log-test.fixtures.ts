import type { AuditLogRecord } from "../../../../src/modules/audit-logs/service";

export class InMemoryAuditLogService {
  logs: Array<{
    adminId: number;
    actionType: string;
    entityType: string;
    entityId: string;
    entityDisplayName?: string;
    reason?: null | string;
    before?: null | Record<string, unknown>;
    after?: null | Record<string, unknown>;
  }> = [];

  async listAuditLogs() {
    return [] satisfies AuditLogRecord[];
  }

  async recordAuditLog(input: {
    adminId: number;
    actionType: string;
    entityType: string;
    entityId: string;
    entityDisplayName?: string;
    reason?: null | string;
    before?: null | Record<string, unknown>;
    after?: null | Record<string, unknown>;
  }) {
    this.logs.push(input);
    return {
      id: this.logs.length,
      adminId: input.adminId,
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId,
      entityDisplayName: input.entityDisplayName ?? null,
      reason: input.reason ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      occurredAtUtc: new Date().toISOString()
    } satisfies AuditLogRecord;
  }
}
