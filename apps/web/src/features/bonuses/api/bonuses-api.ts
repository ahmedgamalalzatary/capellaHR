import type { CreateBonusInput, UpdateBonusInput } from '@capella/contracts';

import { api, type PageMeta } from '@/lib/api/client';

import type {
  FinancialAdjustment,
  ListAdjustmentsParams,
} from '../../financial-adjustments/types';

export type Bonus = FinancialAdjustment & { reason: string | null };

export function listBonuses(
  params: ListAdjustmentsParams = {},
): Promise<{ items: Bonus[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.branchId !== undefined) query.set('branchId', String(params.branchId));
  if (params.employeeId !== undefined) query.set('employeeId', String(params.employeeId));
  if (params.payrollMonth !== undefined) query.set('payrollMonth', params.payrollMonth);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<Bonus>(`/bonuses${suffix}`);
}

export function createBonus(input: CreateBonusInput): Promise<Bonus> {
  return api.post<Bonus>('/bonuses', input);
}

/** The employee is immutable; amount, payroll month, and reason may change. */
export function updateBonus(id: number, input: UpdateBonusInput): Promise<Bonus> {
  return api.patch<Bonus>(`/bonuses/${id}`, input);
}

export function deleteBonus(id: number): Promise<void> {
  return api.delete<void>(`/bonuses/${id}`);
}
