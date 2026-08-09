import type { AdminLoginInput, AuthSessionData, CashierLoginInput } from '@capella/contracts';

import { api } from '@/lib/api/client';

/** All API actors remain explicit so a wrong-application session fails safely. */
export type SessionData = AuthSessionData;

export function cashierLogin(input: CashierLoginInput): Promise<SessionData> {
  return api.post<SessionData>('/auth/cashier/login', input);
}

export function adminLogin(input: AdminLoginInput): Promise<SessionData> {
  return api.post<SessionData>('/auth/admin/login', input);
}

export function getSession(): Promise<SessionData> {
  return api.get<SessionData>('/auth/session');
}

export function logout(): Promise<void> {
  return api.post<void>('/auth/logout');
}
