import type { CommissionDetail, CommissionSummary } from '@capella/contracts';

import { api, type PageMeta } from '@/lib/api/client';

export interface ListCommissionsParams {
  month: string;
  branchId: number;
  employeeId?: number;
  page?: number;
  pageSize?: number;
}

export function listCommissions(
  params: ListCommissionsParams,
): Promise<{ items: CommissionSummary[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  query.set('month', params.month);
  query.set('branchId', String(params.branchId));
  if (params.employeeId !== undefined) query.set('employeeId', String(params.employeeId));
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  return api.getPage<CommissionSummary>(`/erp/commissions?${query.toString()}`);
}

export function getCommissionDetail(employeeId: number, month: string, branchId: number) {
  return api.get<CommissionDetail>(
    `/erp/commissions/${encodeURIComponent(String(employeeId))}/${encodeURIComponent(month)}?branchId=${encodeURIComponent(String(branchId))}`,
  );
}
