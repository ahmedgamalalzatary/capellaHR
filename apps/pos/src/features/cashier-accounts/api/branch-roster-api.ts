import type { BranchCashierRosterItem } from '@capella/contracts';

import { api } from '@/lib/api/client';

export type BranchCashierRosterMember = BranchCashierRosterItem;

/** Employees allowed to sell under a branch's shared cashier login. */
export function listBranchCashierRoster(params: { branchId?: number } = {}) {
  const query = params.branchId === undefined
    ? ''
    : `?branchId=${encodeURIComponent(String(params.branchId))}`;
  return api.get<BranchCashierRosterMember[]>(`/erp/branch-cashier-roster${query}`);
}

/** Full replacement of a branch roster; admin-only on the server. */
export function replaceBranchCashierRoster(branchId: number, employeeIds: number[]) {
  return api.put<BranchCashierRosterMember[]>(
    `/erp/branch-cashier-roster?branchId=${encodeURIComponent(String(branchId))}`,
    { employeeIds },
  );
}
