import type { AdminLoginInput, EmployeeLoginInput } from '@capella/contracts';

import { api } from '@/lib/api/client';

type SessionActor =
  | { type: 'admin' }
  | { type: 'employee' };

export interface SessionData {
  actor: SessionActor;
}

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
