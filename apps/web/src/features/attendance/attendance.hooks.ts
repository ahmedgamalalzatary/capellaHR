import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { attendanceApi } from "@/features/attendance/attendance.api";
import { attendanceKeys } from "@/features/attendance/attendance.keys";
import type {
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
