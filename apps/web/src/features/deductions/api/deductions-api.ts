import type { CreateDeductionInput, UpdateDeductionInput } from '@capella/contracts';

import { api, type PageMeta } from '@/lib/api/client';

import type {
  FinancialAdjustment,
  ListAdjustmentsParams,
} from '../../financial-adjustments/types';

export type Deduction = FinancialAdjustment;

export function listDeductions(
  params: ListAdjustmentsParams = {},
): Promise<{ items: Deduction[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.branchId !== undefined) query.set('branchId', String(params.branchId));
  if (params.employeeId !== undefined) query.set('employeeId', String(params.employeeId));
  if (params.payrollMonth !== undefined) query.set('payrollMonth', params.payrollMonth);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<Deduction>(`/deductions${suffix}`);
}

export function createDeduction(input: CreateDeductionInput): Promise<Deduction> {
  return api.post<Deduction>('/deductions', input);
}

/** The employee is immutable; only amount and payroll month may change. */
export function updateDeduction(id: number, input: UpdateDeductionInput): Promise<Deduction> {
  return api.patch<Deduction>(`/deductions/${id}`, input);
}

export function deleteDeduction(id: number): Promise<void> {
  return api.delete<void>(`/deductions/${id}`);
}
