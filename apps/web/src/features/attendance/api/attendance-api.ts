import { api, type PageMeta } from '@/lib/api/client';

export type AttendanceEventType = 'check_in' | 'check_out';
export type AttendanceDeviceSource = 'personal_device' | 'branch_device';

export interface AttendanceSession {
  id: number;
  employeeId: number;
  employeeCode: number;
  employeeName: string;
  branchId: number;
  branchName: string;
  attendanceDate: string;
  requiredMinutes: number;
  checkInAt: string;
  checkOutAt: string | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  shortageMinutes: number | null;
  automaticTimeoutAt: string | null;
  automaticTimeoutCorrectedAt: string | null;
  flagged: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceDeniedAttempt {
  id: number;
  eventType: AttendanceEventType;
  claimedEmployeeCode: number;
  employeeId: number | null;
  source: AttendanceDeviceSource;
  deviceId: number | null;
  occurredAt: string;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracyMeters: number | null;
  distanceMeters: number | null;
  branchLatitude: number | null;
  branchLongitude: number | null;
  branchRadiusMeters: number | null;
  failureReason: string;
  suspicious: boolean;
  approvedAt: string | null;
  approvedSessionId: number | null;
  dismissedAt: string | null;
  createdAt: string;
}

export interface AttendanceSessionFilters {
  search?: string | undefined;
  employeeId?: number | undefined;
  branchId?: number | undefined;
  state?: 'open' | 'closed' | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface AttendanceDeniedFilters {
  search?: string | undefined;
  employeeId?: number | undefined;
  branchId?: number | undefined;
  eventType?: AttendanceEventType | undefined;
  suspicious?: boolean | undefined;
  approvalState?: 'pending' | 'approved' | 'dismissed' | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

const withQuery = (path: string, params: object) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as Array<[string, unknown]>) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.size ? `${path}?${query.toString()}` : path;
};

export const listAttendanceSessions = (
  filters: AttendanceSessionFilters = {},
): Promise<{ items: AttendanceSession[]; meta: PageMeta }> => api.getPage<AttendanceSession>(
  withQuery('/attendance/sessions', filters),
);

export const listAttendanceDeniedAttempts = (
  filters: AttendanceDeniedFilters = {},
): Promise<{ items: AttendanceDeniedAttempt[]; meta: PageMeta }> => api.getPage<AttendanceDeniedAttempt>(
  withQuery('/attendance/denied-attempts', filters),
);

export const manualAttendance = (
  eventType: AttendanceEventType,
  input: { employeeId: number; occurredAt: string },
) => api.post<AttendanceSession>(
  `/attendance/manual/${eventType === 'check_in' ? 'check-in' : 'check-out'}`,
  input,
);

export const approveDeniedAttempt = (attemptId: number) => (
  api.post<AttendanceSession>(`/attendance/denied-attempts/${attemptId}/approve`)
);

export const dismissDeniedAttempt = (attemptId: number) => (
  api.post<AttendanceDeniedAttempt>(`/attendance/denied-attempts/${attemptId}/dismiss`)
);

export const correctAutomaticTimeout = (sessionId: number, checkOutAt: string) => (
  api.patch<AttendanceSession>(`/attendance/sessions/${sessionId}/automatic-timeout`, { checkOutAt })
);

export interface EmployeeAttendanceInput {
  employeeCode: number;
  pin: string;
  source: AttendanceDeviceSource;
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
  installationMarker: string;
  faceImage: Blob;
}

export const recordEmployeeAttendance = (
  eventType: AttendanceEventType,
  input: EmployeeAttendanceInput,
) => {
  const { faceImage, ...payload } = input;
  const form = new FormData();
  form.set('payload', JSON.stringify(payload));
  form.set('faceImage', faceImage, 'face.jpg');
  return api.postForm<AttendanceSession>(
    `/attendance/${eventType === 'check_in' ? 'check-in' : 'check-out'}`,
    form,
  );
};
