import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { attendanceApi } from "@/features/attendance/attendance.api";
import { attendanceKeys } from "@/features/attendance/attendance.keys";
import type {
  AdminAttendanceCreatePayload,
  AdminAttendanceDeletePayload,
  AdminAttendanceFilters,
  AdminAttendanceUpdatePayload,
  AttendanceActionPayload,
  AttendanceHistoryFilters,
  AttendanceStateResponse
} from "@/features/attendance/attendance.types";

export function useCurrentAttendance() {
  return useQuery({
    queryKey: attendanceKeys.current(),
    queryFn: () => attendanceApi.getCurrent()
  });
}

export function useAttendanceHistory(filters?: AttendanceHistoryFilters) {
  return useQuery({
    queryKey: attendanceKeys.history(filters),
    queryFn: () => attendanceApi.listHistory(filters)
  });
}

export function useRecordAttendanceAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AttendanceActionPayload) => attendanceApi.recordAction(payload),
    onSuccess: (data) => {
      queryClient.setQueryData<AttendanceStateResponse>(attendanceKeys.current(), data);
      queryClient.invalidateQueries({ queryKey: attendanceKeys.histories() });
    }
  });
}

export function useAdminAttendance(filters?: AdminAttendanceFilters) {
  return useQuery({
    queryKey: attendanceKeys.adminList(filters),
    queryFn: () => attendanceApi.listAdmin(filters)
  });
}

export function useCreateAdminAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AdminAttendanceCreatePayload) => attendanceApi.createAdmin(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: attendanceKeys.adminLists() });
    }
  });
}

export function useUpdateAdminAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sessionId,
      payload
    }: {
      sessionId: number;
      payload: AdminAttendanceUpdatePayload;
    }) => attendanceApi.updateAdmin(sessionId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: attendanceKeys.adminLists() });
    }
  });
}

export function useDeleteAdminAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sessionId,
      payload
    }: {
      sessionId: number;
      payload: AdminAttendanceDeletePayload;
    }) => attendanceApi.deleteAdmin(sessionId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: attendanceKeys.adminLists() });
    }
  });
}
