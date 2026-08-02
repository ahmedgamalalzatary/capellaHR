import { api } from '@/lib/api/client';

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
