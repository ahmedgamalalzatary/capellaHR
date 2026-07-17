import { api } from '@/lib/api/client';

export type DeviceAssignmentType = 'employee' | 'branch';
export type DeviceStatus = 'active' | 'revoked';

export interface Device {
  id: number;
  assignmentType: DeviceAssignmentType;
  assignmentId: number;
  status: DeviceStatus;
  browser: string;
  platform: string;
  pairedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface DeviceHistoryEvent {
  event: 'paired' | 'verified' | 'revoked';
  createdAt: string;
}

export interface ListDevicesParams {
  assignmentType?: DeviceAssignmentType;
  assignmentId?: number;
  status?: DeviceStatus;
  page?: number;
  pageSize?: number;
}

export interface PairingRequest {
  id: number;
  /** Single-use secret; shown once and never retrievable again. */
  pairingToken: string;
}

export function listDevices(params: ListDevicesParams = {}) {
  const query = new URLSearchParams();
  if (params.assignmentType) query.set('assignmentType', params.assignmentType);
  if (params.assignmentId !== undefined) query.set('assignmentId', String(params.assignmentId));
  if (params.status) query.set('status', params.status);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return api.getPage<Device>(`/devices${suffix}`);
}

export function getDevice(id: number) {
  return api.get<Device>(`/devices/${id}`);
}

export function getDeviceHistory(id: number) {
  return api.get<DeviceHistoryEvent[]>(`/devices/${id}/history`);
}

export function createPairing(input: { assignmentType: DeviceAssignmentType; assignmentId: number }) {
  return api.post<PairingRequest>('/devices/pairings', input);
}

export function cancelPairing(id: number) {
  return api.delete<void>(`/devices/pairings/${id}`);
}

/** Permanent: a revoked device must pair from scratch to be used again. */
export function revokeDevice(id: number) {
  return api.delete<void>(`/devices/${id}`);
}
