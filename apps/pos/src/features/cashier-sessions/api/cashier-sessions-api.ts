import type { CashierSessionDto, RecoveryCloseCashierSessionInput } from '@capella/contracts';

import { api } from '@/lib/api/client';

export type CashierSession = CashierSessionDto;

export interface CashierSessionBranch {
  id: number;
  name: string;
}

export function getCurrentCashierSession(branchId?: number) {
  const query = branchId === undefined ? '' : `?branchId=${encodeURIComponent(String(branchId))}`;
  return api.get<CashierSession | null>(`/erp/cashier-sessions/current${query}`);
}

export function openCashierSession() {
  return api.post<CashierSession>('/erp/cashier-sessions/open');
}

export function closeCashierSession() {
  return api.post<CashierSession>('/erp/cashier-sessions/close');
}

export function recoveryCloseCashierSession(
  sessionId: number,
  input: RecoveryCloseCashierSessionInput,
) {
  return api.post<CashierSession>(
    `/erp/cashier-sessions/${encodeURIComponent(String(sessionId))}/recovery-close`,
    input,
  );
}

export function listCashierSessionBranches(page = 1) {
  return api.getPage<CashierSessionBranch>(`/branches?page=${page}&pageSize=100`);
}
