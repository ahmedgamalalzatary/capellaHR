import { api } from '@/lib/api/client';

import type {
  EmployeeCreateFormValues,
  EmployeeUpdateFormValues,
} from '../schemas/employee-form';

export type EmployeeImageKind = 'personal' | 'idFront' | 'idBack';

export interface EmployeeImageMeta {
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
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** Cookie-authenticated binary endpoint; usable directly as an <img> source. */
export const employeeImageUrl = (id: number, kind: EmployeeImageKind) =>
  `${API_BASE_URL}/employees/${id}/images/${kind}`;

export function listEmployees(params: ListEmployeesParams = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.branchId !== undefined) query.set('branchId', String(params.branchId));
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<Employee>(`/employees${suffix}`);
}

export function getEmployee(id: number) {
  return api.get<Employee>(`/employees/${id}`);
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
