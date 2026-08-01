import { api } from '@/lib/api/client';

export interface EmployeeOption {
  id: number;
  fullName: string;
}

/** Only what the promote-cashier select needs; active employees only. */
export function listActiveEmployeeOptions(page: number) {
  return api.getPage<EmployeeOption>(`/employees?status=active&page=${page}`);
}
