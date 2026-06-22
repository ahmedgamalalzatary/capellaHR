import type { AuditLogListFilterInput } from "@capella/shared";
import type { AuditLogRecord } from "./types";

export type { AuditLogRecord } from "./types";

export type AuditLogRepository = {
  listAuditLogs(filters: AuditLogListFilterInput): Promise<{
    items: AuditLogRecord[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }>;
  createAuditLog(input: {
    adminId: number;
    actionType: string;
    entityType: string;
    entityId: string;
    entityDisplayName?: string;
    reason?: null | string;
    before?: null | Record<string, unknown>;
    after?: null | Record<string, unknown>;
    occurredAtUtc: Date;
  }): Promise<AuditLogRecord>;
};

type CreateAuditLogServiceOptions = {
  repository: AuditLogRepository;
  now?: () => Date;
};

export function createAuditLogService(options: CreateAuditLogServiceOptions) {
  return {
    async listAuditLogs(filters: AuditLogListFilterInput) {
      return options.repository.listAuditLogs(filters);
    },

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
      return options.repository.createAuditLog({
        ...input,
        occurredAtUtc: (options.now ?? (() => new Date()))()
      });
    }
  };
}
