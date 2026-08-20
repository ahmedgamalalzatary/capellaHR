import type {
  CashierSessionDetailDto,
  CashierSessionDto,
  CashierSessionSummaryDto,
  RecoveryCloseCashierSessionInput,
} from '@capella/contracts';

import { api } from '@/lib/api/client';

export type CashierSession = CashierSessionDto;
/** A shift with the money it moved: the same row the history and the live card read. */
export type CashierSessionSummary = CashierSessionSummaryDto;
export type CashierSessionDetail = CashierSessionDetailDto;

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

export function listCashierSessions(params: { branchId?: number; page?: number } = {}) {
  const query = new URLSearchParams({ page: String(params.page ?? 1), pageSize: '10' });
  if (params.branchId !== undefined) query.set('branchId', String(params.branchId));
  return api.getPage<CashierSessionSummary>(`/erp/cashier-sessions?${query.toString()}`);
}

export function getCashierSessionSummary(sessionId: number) {
  return api.get<CashierSessionSummary>(
    `/erp/cashier-sessions/${encodeURIComponent(String(sessionId))}`,
  );
}

export function getCashierSessionDetail(sessionId: number) {
  return api.get<CashierSessionDetail>(
    `/erp/cashier-sessions/${encodeURIComponent(String(sessionId))}/invoices`,
  );
}

export function listCashierSessionBranches(page = 1) {
  return api.getPage<CashierSessionBranch>(`/branches?page=${page}&pageSize=100`);
}
