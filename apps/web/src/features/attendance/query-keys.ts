import type { AttendanceDeniedFilters, AttendanceSessionFilters } from './api/attendance-api';

export const attendanceQueryKeys = {
  all: ['attendance'] as const,
  sessions: (filters: AttendanceSessionFilters) => ['attendance', 'sessions', filters] as const,
  denied: (filters: AttendanceDeniedFilters) => ['attendance', 'denied', filters] as const,
};
