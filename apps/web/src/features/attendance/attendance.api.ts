import { api } from "@/shared/lib/api-client";
import type {
  AdminAttendanceCreatePayload,
  AdminAttendanceDeletePayload,
  AdminAttendanceFilters,
  AdminAttendanceListResponse,
  AdminAttendanceSessionResponse,
  AdminAttendanceUpdatePayload,
  AttendanceActionPayload,
  AttendanceHistoryFilters,
  AttendanceHistoryResponse,
  AttendanceStateResponse
} from "@/features/attendance/attendance.types";

export const attendanceApi = {
  getCurrent: () => api.get<AttendanceStateResponse>("/attendance/me"),

  listHistory: (filters?: AttendanceHistoryFilters) =>
    api.get<AttendanceHistoryResponse>("/attendance/history", { query: filters }),

  recordAction: (payload: AttendanceActionPayload) =>
    api.post<AttendanceStateResponse>("/attendance/action", { json: payload }),

  listAdmin: (filters?: AdminAttendanceFilters) =>
    api.get<AdminAttendanceListResponse>("/admin/attendance", { query: filters }),

  createAdmin: (payload: AdminAttendanceCreatePayload) =>
    api.post<AdminAttendanceSessionResponse>("/admin/attendance", { json: payload }),

  updateAdmin: (sessionId: number, payload: AdminAttendanceUpdatePayload) =>
    api.patch<AdminAttendanceSessionResponse>(`/admin/attendance/${sessionId}`, { json: payload }),

  deleteAdmin: async (sessionId: number, payload: AdminAttendanceDeletePayload): Promise<void> => {
    await api.delete<null>(`/admin/attendance/${sessionId}`, { json: payload });
  }
};
