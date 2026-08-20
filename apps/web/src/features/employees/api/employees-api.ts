import { api } from '@/lib/api/client';

import type {
  EmployeeCreateFormValues,
  EmployeeUpdateFormValues,
} from '../schemas/employee-form';

export type EmployeeImageKind = 'personal' | 'idFront' | 'idBack';

interface EmployeeImageMeta {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface Employee {
  id: number;
  employeeCode: number;
  fullName: string;
  personalPhone: string;
  whatsappPhone: string;
  age: number;
  address: string;
  branchId: number;
  shiftDurationMinutes: number;
  /** Two-decimal EGP amount serialized as a string by the API. */
  monthlyBaseSalary: string;
  employmentStatus: 'active' | 'inactive';
  images: Record<EmployeeImageKind, EmployeeImageMeta>;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListEmployeesParams {
  search?: string;
  branchId?: number;
  page?: number;
  pageSize?: number;
  status?: 'active' | 'inactive' | 'all';
}

export function listEmployees(params: ListEmployeesParams = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.branchId !== undefined) query.set('branchId', String(params.branchId));
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  if (params.status !== undefined) query.set('status', params.status);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<Employee>(`/employees${suffix}`);
}

/** The API accepts employees as multipart: scalar fields plus the image files. */
function toFormData(values: Record<string, string | number | File | undefined>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (value instanceof File) form.append(key, value);
    else form.append(key, String(value));
  }
  return form;
}

export function createEmployee(values: EmployeeCreateFormValues) {
  return api.postForm<Employee>('/employees', toFormData(values));
}

export function updateEmployee(id: number, values: EmployeeUpdateFormValues) {
  return api.patchForm<Employee>(`/employees/${id}`, toFormData(values));
}

export function deleteEmployee(id: number) {
  return api.delete<void>(`/employees/${id}`);
}

/** What to do with the advances still outstanding when the employee is deactivated. */
export type AdvanceDecision = 'sum_all' | 'zero_salary' | 'ignore_debt';
/** How to resolve a shortfall that remains after `sum_all`. */
export type NegativeBalanceDecision = 'collect_cash' | 'record_debt';

export interface EmployeeDeactivationPreview {
  unpaidInstallmentCount: number;
  unpaidAdvanceAmount: string;
  /** The month's salary as it stands, before any advance decision is applied. */
  currentNetSalary: string;
  /** What the salary becomes once the outstanding advances are summed onto this month. */
  projectedNetSalary: string;
  amountOwed: string;
  /** False when the employee is owed more than they owe, which makes zeroing unfair. */
  canZeroSalary: boolean;
  /** True when the deactivation will wait for the employee to check out. */
  hasOpenSession: boolean;
}

export function previewEmployeeDeactivation(id: number) {
  return api.get<EmployeeDeactivationPreview>(`/employees/${id}/deactivation-preview`);
}

export function deactivateEmployee(
  id: number,
  advanceDecision: AdvanceDecision,
  negativeBalanceDecision: NegativeBalanceDecision | undefined,
  preview: EmployeeDeactivationPreview,
  departure: { reason: string; lastWorkingDay: string },
) {
  return api.post<Employee>(`/employees/${id}/deactivate`, {
    reason: departure.reason,
    lastWorkingDay: departure.lastWorkingDay,
    advanceDecision,
    ...(negativeBalanceDecision === undefined ? {} : { negativeBalanceDecision }),
    expectedUnpaidInstallmentCount: preview.unpaidInstallmentCount,
    expectedUnpaidAdvanceAmount: preview.unpaidAdvanceAmount,
    expectedProjectedNetSalary: preview.projectedNetSalary,
    expectedAmountOwed: preview.amountOwed,
  });
}

/** Money the employee still owes after leaving. `settledAt` is set once they have paid. */
export interface EmployeeDebt {
  id: number;
  payrollMonth: string;
  amount: string;
  createdAt: string;
  settledAt: string | null;
}

export function listEmployeeDebts(id: number) {
  return api.get<EmployeeDebt[]>(`/employees/${id}/debts`);
}

export function settleEmployeeDebt(id: number, debtId: number) {
  return api.post<EmployeeDebt>(`/employees/${id}/debts/${debtId}/settle`, {});
}

/**
 * The end-of-service statement, frozen at the moment of termination. Reprints identically
 * however long afterwards, because none of it is recomputed from live payroll.
 */
export interface EmployeeSettlementStatement {
  employee: { id: number; employeeCode: number; fullName: string };
  reason: string;
  lastWorkingDay: string;
  terminatedAt: string;
  netSalaryBeforeSettlement: string;
  advancesRecovered: string;
  writeOffAmount: string;
  forfeitedSalaryAmount: string;
  cashCollectedAmount: string;
  debtRecordedAmount: string;
  finalNetSalary: string;
}

export function getEmployeeSettlement(id: number) {
  return api.get<EmployeeSettlementStatement>(`/employees/${id}/settlement`);
}

export function activateEmployee(id: number) {
  return api.post<Employee>(`/employees/${id}/activate`, {});
}
