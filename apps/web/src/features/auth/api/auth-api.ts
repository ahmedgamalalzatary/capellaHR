import type { AdminLoginInput, EmployeeLoginInput } from '@capella/contracts';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

import { api } from '@/lib/api/client';

export type SessionActor =
  | { type: 'admin' }
  | { type: 'employee'; employeeId: number };

export interface SessionData {
  actor: SessionActor;
}

export function adminLogin(input: AdminLoginInput): Promise<SessionData> {
  return api.post<SessionData>('/auth/admin/login', input);
}

export function employeeLogin(input: EmployeeLoginInput): Promise<SessionData> {
  return api.post<SessionData>('/auth/employee/login', input);
}

export interface EmployeeDeviceOptions {
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

/** One-time WebAuthn authentication challenge for the registered personal phone. */
export function getEmployeeDeviceOptions(input: {
  employeeCode: number;
  installationMarker: string;
}): Promise<EmployeeDeviceOptions> {
  return api.post<EmployeeDeviceOptions>('/auth/employee/device-options', input);
}

export function getSession(): Promise<SessionData> {
  return api.get<SessionData>('/auth/session');
}

export function logout(): Promise<void> {
  return api.post<void>('/auth/logout');
}
