import { createAdminAttendanceService } from "./admin-attendance.service";
import { createEmployeeAttendanceService } from "./employee-attendance.service";
import type { AttendanceRepository } from "./attendance-utils";
import type { createAuditLogService } from "../audit-logs/service";

export type { AdminAttendanceRecord, AttendanceBlockedAttemptRecord, AttendanceSessionRecord } from "./repository";
export type {
  AttendanceRepository,
  BranchPolicyRecord,
  EmployeeAttendanceRecord
} from "./attendance-utils";

type CreateAttendanceServiceOptions = {
  repository: AttendanceRepository;
  auditLogService?: ReturnType<typeof createAuditLogService>;
};

export function createAttendanceService(options: CreateAttendanceServiceOptions) {
  return {
    ...createEmployeeAttendanceService(options.repository),
    ...createAdminAttendanceService(options.repository, options.auditLogService)
  };
}
