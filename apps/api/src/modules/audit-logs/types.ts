export type AuditLogRecord = {
  id: number;
  adminId: number;
  actionType: string;
  entityType: string;
  entityId: string;
  entityDisplayName: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  occurredAtUtc: string;
};
