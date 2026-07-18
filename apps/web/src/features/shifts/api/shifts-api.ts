import type { UpdateShiftAssignmentInput } from '@capella/contracts';

import { api, type PageMeta } from '@/lib/api/client';

/** One employee's required work duration. Every employee has exactly one. */
export interface ShiftAssignment {
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  durationMinutes: number;
}

export interface ListShiftAssignmentsParams {
  search?: string;
  branchId?: number;
  page?: number;
  pageSize?: number;
}

export function listShiftAssignments(
  params: ListShiftAssignmentsParams = {},
): Promise<{ items: ShiftAssignment[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.branchId !== undefined) query.set('branchId', String(params.branchId));
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<ShiftAssignment>(`/shifts${suffix}`);
}

export function getShiftAssignment(employeeId: number): Promise<ShiftAssignment> {
  return api.get<ShiftAssignment>(`/shifts/employees/${employeeId}`);
}

/** Single-employee update; bulk shift updates are out of scope by design. */
export function updateShiftAssignment(
  employeeId: number,
  input: UpdateShiftAssignmentInput,
): Promise<ShiftAssignment> {
  return api.patch<ShiftAssignment>(`/shifts/employees/${employeeId}`, input);
}
