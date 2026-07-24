import type { ListAuditEventsQuery } from '@capella/contracts';

interface AuditEventRecord {
  id: number;
  actorType: 'admin' | 'employee' | 'system';
  actorIdentifier: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  beforeState: unknown;
  afterState: unknown;
  relatedIds: Record<string, string> | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface AuditRepository {
  list(query: ListAuditEventsQuery): Promise<{ items: AuditEventRecord[]; total: number }>;
}

export const createAuditService = (repository: AuditRepository) => ({
  list(query: ListAuditEventsQuery) {
    return repository.list(query);
  },
});

export type AuditService = ReturnType<typeof createAuditService>;
