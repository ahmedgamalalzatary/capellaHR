import { api } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';

/**
 * The only employee identity the POS receives. Presence itself lives in HR
 * attendance; the counter never sees sessions, devices, or GPS.
 */
export interface AssignableEmployee {
  id: number;
  employeeCode: number;
  fullName: string;
  branchId: number;
}

export interface ListAssignableEmployeesParams {
  /** Admins act on a named branch; a cashier's branch comes from their account. */
  branchId?: number;
}

export function listAssignableEmployees(params: ListAssignableEmployeesParams = {}) {
  const query = params.branchId === undefined ? '' : `?branchId=${params.branchId}`;
  return api.get<AssignableEmployee[]>(`/erp/assignable-employees${query}`);
}

/** Admin service corrections use the active branch directory, regardless of attendance. */
export function listReassignmentEmployees(branchId: number) {
  return fetchAllPages((page) => api.getPage<AssignableEmployee>(
    `/employees?status=active&branchId=${encodeURIComponent(String(branchId))}&page=${page}&pageSize=100`,
  ));
}
