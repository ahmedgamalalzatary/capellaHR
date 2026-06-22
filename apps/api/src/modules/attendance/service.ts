import { createAdminAttendanceService } from "./admin-attendance.service";
import { createEmployeeAttendanceService } from "./employee-attendance.service";
import type { AttendanceRepository } from "./attendance-utils";

export type { AdminAttendanceRecord, AttendanceBlockedAttemptRecord, AttendanceSessionRecord } from "./repository";
export type {
  AttendanceRepository,
  BranchPolicyRecord,
  EmployeeAttendanceRecord
} from "./attendance-utils";

type CreateAttendanceServiceOptions = {
  repository: AttendanceRepository;
};

export function createAttendanceService(options: CreateAttendanceServiceOptions) {
  return {
    ...createEmployeeAttendanceService(options.repository),
    ...createAdminAttendanceService(options.repository)
  };
}
