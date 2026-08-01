import type { AdminLoginInput, CashierLoginInput } from '@capella/contracts';

import { api } from '@/lib/api/client';

/**
 * The `capella_session` cookie is shared with the HR web app, so an HR
 * employee session is technically visible here too; `employee` is included
 * so route guards can detect and reject it explicitly.
 */
export type SessionActor =
  | { type: 'admin' }
  | { type: 'cashier'; accountId: number; employeeId: number }
  | { type: 'employee' };

export interface SessionData {
  actor: SessionActor;
}

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
