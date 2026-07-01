import { api } from "@/shared/lib/api-client";
import type {
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
    api.post<AttendanceStateResponse>("/attendance/action", { json: payload })
};
