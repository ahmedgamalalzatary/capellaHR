import type {
  AdminAttendanceCreateInput,
  AdminAttendanceDeleteInput,
  AdminAttendanceUpdateInput,
  AttendanceActionInput,
  AttendanceActionType,
  AttendanceListFilterInput
} from "@capella/shared";
import type { Pagination } from "@/features/branches/branches.types";

export type AttendanceSession = {
  id: number;
  employeeId: number;
  branchId: number;
  status: "open" | "completed";
  checkInAtUtc: string;
  checkOutAtUtc: string | null;
  checkInLatitude: number;
  checkInLongitude: number;
  checkInIpAddress: string;
  deviceId: string;
  branchPolicySnapshot: Record<string, unknown>;
};

export type AttendanceState = {
  employeeId: number;
  currentAction: AttendanceActionType;
  openSession: AttendanceSession | null;
  todaySessions: AttendanceSession[];
};

export type AttendanceStateResponse = {
  attendance: AttendanceState;
};

export type AttendanceHistoryFilters = {
  page?: number;
  pageSize?: number;
};

export type AttendanceHistoryResponse = {
  sessions: {
    items: AttendanceSession[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  };
};

export type AttendanceActionPayload = AttendanceActionInput;

export type AdminAttendanceSession = AttendanceSession & {
  employeeName: string;
  adminReason: string | null;
  createdByAdminId: number | null;
  updatedByAdminId: number | null;
};

export type AdminAttendanceFilters = AttendanceListFilterInput;

export type AdminAttendanceListResponse = {
  sessions: {
    items: AdminAttendanceSession[];
    pagination: Pagination;
  };
};

export type AdminAttendanceSessionResponse = {
  session: AdminAttendanceSession;
};

export type AdminAttendanceCreatePayload = AdminAttendanceCreateInput;
export type AdminAttendanceUpdatePayload = AdminAttendanceUpdateInput;
export type AdminAttendanceDeletePayload = AdminAttendanceDeleteInput;
