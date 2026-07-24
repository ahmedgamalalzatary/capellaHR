import type { CreateAdvanceInput, UpdateAdvanceInput } from '@capella/contracts';

import { api, type PageMeta } from '@/lib/api/client';

export interface AdvanceInstallment {
  id: number;
  ordinal: number;
  payrollMonth: string;
  amount: string;
}

/** A disbursed advance repaid over one to twelve consecutive monthly installments. */
export interface Advance {
  id: number;
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  amount: string;
  installmentCount: number;
  startMonth: string;
  employeeDeletedAt: string | null;
  installments: AdvanceInstallment[];
  createdAt: string;
  updatedAt: string;
}

export interface ListAdvancesParams {
  search?: string;
  branchId?: number;
  employeeId?: number;
  payrollMonth?: string;
  page?: number;
  pageSize?: number;
}

export function listAdvances(
  params: ListAdvancesParams = {},
): Promise<{ items: Advance[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.branchId !== undefined) query.set('branchId', String(params.branchId));
  if (params.employeeId !== undefined) query.set('employeeId', String(params.employeeId));
  if (params.payrollMonth !== undefined) query.set('payrollMonth', params.payrollMonth);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<Advance>(`/advances${suffix}`);
}

export function createAdvance(input: CreateAdvanceInput): Promise<Advance> {
  return api.post<Advance>('/advances', input);
}

/** Regenerates the whole installment schedule; locked once any installment is finalized. */
export function updateAdvance(id: number, input: UpdateAdvanceInput): Promise<Advance> {
  return api.patch<Advance>(`/advances/${id}`, input);
}

export function deleteAdvance(id: number): Promise<void> {
  return api.delete<void>(`/advances/${id}`);
}
