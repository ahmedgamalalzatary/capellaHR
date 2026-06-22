import type { AttendanceActionInput } from "@capella/shared";
import type { AttendanceSessionRecord } from "./repository";
import {
  type AttendanceErrorResult,
  createDateConflictError,
  createEmployeeNotFoundError,
  createMonthLockedError,
  createOvernightNotAllowedError
} from "./attendance-errors";
import {
  type AttendanceRepository,
  type BranchPolicyRecord,
  type EmployeeAttendanceRecord,
  getCairoDateKey,
  isAllowedDevice,
  isIpInCidr,
  isWithinRadiusMeters
} from "./attendance-utils";

export async function loadAttendanceContext(
  repository: AttendanceRepository,
  employeeId: number,
  now: Date
): Promise<{
  employee: EmployeeAttendanceRecord;
  branch: BranchPolicyRecord;
  openSession: AttendanceSessionRecord | null;
  sessions: AttendanceSessionRecord[];
  activeDeviceFingerprint: string | null;
  now: Date;
} | AttendanceErrorResult> {
  const employee = await repository.findEmployeeById(employeeId);

  if (!employee || employee.softDeletedAt !== null) {
    return createEmployeeNotFoundError();
  }

  if (!employee.branchId) {
    return {
      error: {
        code: "EMPLOYEE_BRANCH_NOT_ASSIGNED",
        message: "Employee is not assigned to a branch",
        details: {}
      }
    };
  }

  const branch = await repository.findBranchById(employee.branchId);

  if (!branch || branch.setupStatus !== "completed") {
    return {
      error: {
        code: "BRANCH_NOT_READY",
        message: "Branch attendance policy is not ready",
        details: {}
      }
    };
  }

  const [openSession, sessions, activeDeviceFingerprint] = await Promise.all([
    repository.findOpenSession(employeeId),
    repository.listEmployeeSessions(employeeId),
    repository.findActiveEmployeeDeviceFingerprint(employeeId)
  ]);

  return {
    employee,
    branch,
    openSession,
    sessions,
    activeDeviceFingerprint,
    now
  };
}

export async function validateAttendanceAction(input: {
  repository: AttendanceRepository;
  employeeId: number;
  input: AttendanceActionInput;
  ipAddress: string;
  now: Date;
  branch: BranchPolicyRecord;
  activeDeviceFingerprint: string | null;
  branchPolicySnapshot: Record<string, unknown>;
}) {
  const dateKey = getCairoDateKey(input.now);
  const monthKey = dateKey.slice(0, 7);
  const failureReasons: string[] = [];

  const [hasWeeklyDayOff, hasPermissionAbsence, isMonthLocked] = await Promise.all([
    input.repository.hasWeeklyDayOff(input.employeeId, dateKey),
    input.repository.hasPermissionAbsence(input.employeeId, dateKey),
    input.repository.isMonthLocked(monthKey)
  ]);

  if (isMonthLocked) {
    failureReasons.push("month_locked");
  }

  if (hasWeeklyDayOff) {
    failureReasons.push("weekly_day_off");
  }

  if (hasPermissionAbsence) {
    failureReasons.push("permission_absence");
  }

  if (!isAllowedDevice(input.input.deviceId, input.activeDeviceFingerprint, input.branch.registeredDeviceToken)) {
    failureReasons.push("device_not_allowed");
  }

  if (!isWithinRadiusMeters(
    input.input.latitude,
    input.input.longitude,
    Number(input.branch.gpsLatitude),
    Number(input.branch.gpsLongitude),
    input.branch.gpsRadiusMeters
  )) {
    failureReasons.push("gps_out_of_range");
  }

  if (!isIpInCidr(input.ipAddress, input.branch.allowedIpCidr)) {
    failureReasons.push("ip_not_allowed");
  }

  return {
    failureReasons,
    branchPolicySnapshot: input.branchPolicySnapshot
  };
}

export async function validateAdminAttendanceMutation(
  repository: AttendanceRepository,
  employeeId: number,
  checkInAtUtc: Date,
  checkOutAtUtc: Date | null
) {
  if (checkOutAtUtc && getCairoDateKey(checkInAtUtc) !== getCairoDateKey(checkOutAtUtc)) {
    return createOvernightNotAllowedError();
  }

  const dateKey = getCairoDateKey(checkInAtUtc);
  const monthKey = dateKey.slice(0, 7);

  if (await repository.isMonthLocked(monthKey)) {
    return createMonthLockedError();
  }

  if (await repository.hasWeeklyDayOff(employeeId, dateKey)) {
    return createDateConflictError("weekly_day_off");
  }

  if (await repository.hasPermissionAbsence(employeeId, dateKey)) {
    return createDateConflictError("permission_absence");
  }

  return null;
}
