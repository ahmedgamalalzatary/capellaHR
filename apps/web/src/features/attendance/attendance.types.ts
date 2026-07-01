import type { AttendanceActionInput, AttendanceActionType } from "@capella/shared";

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
