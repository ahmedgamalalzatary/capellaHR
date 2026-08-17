import type { PublicCashierAccount, UpsertBranchCashierInput } from '@capella/contracts';

import { api } from '@/lib/api/client';

export type CashierAccount = PublicCashierAccount;

export interface ListCashierAccountsParams {
  page?: number;
  pageSize?: number;
}

export function listCashierAccounts(params: ListCashierAccountsParams = {}) {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<CashierAccount>(`/auth/cashier-accounts${suffix}`);
}

/** Creates or rewrites the single shared login of a branch. */
export function upsertBranchCashier(input: UpsertBranchCashierInput) {
  return api.post<CashierAccount>('/auth/cashier-accounts', input);
}

export function setCashierAccountStatus(accountId: number, active: boolean) {
  return api.patch<CashierAccount>(`/auth/cashier-accounts/${accountId}/status`, { active });
}

/**
 * Retires the branch login for good. The invoices and shifts it acted on keep
 * pointing at it, so the account is withdrawn rather than erased.
 */
export function deleteCashierAccount(accountId: number) {
  return api.delete<CashierAccount>(`/auth/cashier-accounts/${accountId}`);
}

