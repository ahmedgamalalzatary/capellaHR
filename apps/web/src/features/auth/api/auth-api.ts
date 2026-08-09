import type { AdminLoginInput, AuthSessionData, EmployeeLoginInput } from '@capella/contracts';

import { api } from '@/lib/api/client';

export type SessionData = AuthSessionData;

export function adminLogin(input: AdminLoginInput): Promise<SessionData> {
  return api.post<SessionData>('/auth/admin/login', input);
}

export function employeeLogin(input: EmployeeLoginInput): Promise<SessionData> {
  return api.post<SessionData>('/auth/employee/login', input);
}

export function getSession(): Promise<SessionData> {
  return api.get<SessionData>('/auth/session');
}

export function logout(): Promise<void> {
  return api.post<void>('/auth/logout');
}
