import type { UpdateBaseSalaryInput } from '@capella/contracts';

import { api, type PageMeta } from '@/lib/api/client';

/** One employee's payroll for one Cairo month: open preview or immutable snapshot. */
export interface PayrollRecord {
  id: number;
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  payrollMonth: string;
  status: 'open' | 'finalized';
  baseSalary: string;
  proratedBase: string;
  overtimeAmount: string;
  bonusAmount: string;
  attendanceDeductionAmount: string;
  manualDeductionAmount: string;
  advanceAmount: string;
  priorNegativeCarry: string;
  netSalary: string;
  eligibleWorkdays: number;
  fullMonthWorkdays: number;
  requiredMinutes: number;
  overtimeMinutes: number;
  shortageMinutes: number;
  finalizedAt: string | null;
}

export interface BaseSalaryRecord {
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  amount: string;
  deletedAt: string | null;
}

export interface ListPayrollMonthsParams {
  month: string;
  search?: string;
  branchId?: number;
  page?: number;
  pageSize?: number;
}

export function listPayrollMonths(
  params: ListPayrollMonthsParams,
): Promise<{ items: PayrollRecord[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  query.set('month', params.month);
  if (params.search) query.set('search', params.search);
  if (params.branchId !== undefined) query.set('branchId', String(params.branchId));
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  return api.getPage<PayrollRecord>(`/payroll?${query.toString()}`);
}

/** Applies to the whole current Cairo month and future months; past months keep their periods. */
export function updateBaseSalary(
  employeeId: number,
  input: UpdateBaseSalaryInput,
): Promise<BaseSalaryRecord> {
  return api.patch<BaseSalaryRecord>(`/payroll/employees/${employeeId}/base-salary`, input);
}

/** Permanently locks the employee-month; there is no unfinalize. */
export function finalizePayroll(employeeId: number, month: string): Promise<PayrollRecord> {
  return api.post<PayrollRecord>(`/payroll/employees/${employeeId}/months/${month}/finalize`);
}

/** Atomically finalizes every remaining employee-month in the branch, or nobody. */
export function finalizeBranchPayroll(branchId: number, month: string): Promise<PayrollRecord[]> {
  return api.post<PayrollRecord[]>(`/payroll/branches/${branchId}/months/${month}/finalize`);
}
