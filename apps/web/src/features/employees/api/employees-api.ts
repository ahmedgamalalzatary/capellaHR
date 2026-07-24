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

export interface EmployeeDeactivationPreview {
  unpaidInstallmentCount: number;
  unpaidAdvanceAmount: string;
  projectedNetSalary: string;
  amountOwed: string;
}

export function previewEmployeeDeactivation(id: number) {
  return api.get<EmployeeDeactivationPreview>(`/employees/${id}/deactivation-preview`);
}

export function deactivateEmployee(
  id: number,
  negativeBalanceDecision: 'keep_debt' | 'paid',
  preview: EmployeeDeactivationPreview,
) {
  return api.post<Employee>(`/employees/${id}/deactivate`, {
    advanceDecision: 'accelerate',
    negativeBalanceDecision,
    expectedUnpaidInstallmentCount: preview.unpaidInstallmentCount,
    expectedUnpaidAdvanceAmount: preview.unpaidAdvanceAmount,
    expectedProjectedNetSalary: preview.projectedNetSalary,
    expectedAmountOwed: preview.amountOwed,
  });
}

export function activateEmployee(id: number) {
  return api.post<Employee>(`/employees/${id}/activate`, {});
}
