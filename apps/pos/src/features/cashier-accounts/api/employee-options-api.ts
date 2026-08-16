import { api } from '@/lib/api/client';

export interface EmployeeOption {
  id: number;
  fullName: string;
}

/** Only what the roster editor needs; active employees of one branch. */
export function listActiveEmployeeOptions(page: number, branchId?: number) {
  const branchQuery = branchId === undefined ? '' : `&branchId=${encodeURIComponent(String(branchId))}`;
  return api.getPage<EmployeeOption>(`/employees?status=active${branchQuery}&page=${page}`);
}
