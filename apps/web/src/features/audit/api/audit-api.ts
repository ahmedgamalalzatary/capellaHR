import type { AuditActorType, AuditEventDto } from '@capella/contracts';

import { api, type PageMeta } from '@/lib/api/client';

export interface ListAuditEventsParams {
  search?: string;
  actorType?: AuditActorType;
  module?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  requestId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export function listAuditEvents(
  params: ListAuditEventsParams = {},
): Promise<{ items: AuditEventDto[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.actorType) query.set('actorType', params.actorType);
  if (params.module) query.set('module', params.module);
  if (params.action) query.set('action', params.action);
  if (params.entityType) query.set('entityType', params.entityType);
  if (params.entityId) query.set('entityId', params.entityId);
  if (params.requestId) query.set('requestId', params.requestId);
  if (params.dateFrom) query.set('dateFrom', params.dateFrom);
  if (params.dateTo) query.set('dateTo', params.dateTo);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<AuditEventDto>(`/audit${suffix}`);
}
