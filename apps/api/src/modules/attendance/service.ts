import type {
  AdminAttendanceCreateInput,
  AdminAttendanceUpdateInput,
  AttendanceActionInput,
  AttendanceListFilterInput
} from "@capella/shared";
import type {
  AdminAttendanceRecord,
  AttendanceBlockedAttemptRecord,
  AttendanceSessionRecord
} from "./repository";
export type { AdminAttendanceRecord, AttendanceBlockedAttemptRecord, AttendanceSessionRecord } from "./repository";

export type EmployeeAttendanceRecord = {
  id: number;
  fullName: string;
  branchId: number | null;
  softDeletedAt: Date | null;
};

export type BranchPolicyRecord = {
  id: number;
  setupStatus: "setup_pending" | "completed";
  gpsLatitude: string;
  gpsLongitude: string;
  gpsRadiusMeters: number;
  allowedIpCidr: string;
  registeredDeviceToken: string | null;
};

type AttendanceState = {
  employeeId: number;
  currentAction: "check_in" | "check_out";
  openSession: AttendanceSessionRecord | null;
  todaySessions: AttendanceSessionRecord[];
};

type AttendanceErrorResult = {
  error: {
    code:
      | "EMPLOYEE_NOT_FOUND"
      | "EMPLOYEE_BRANCH_NOT_ASSIGNED"
      | "BRANCH_NOT_READY"
      | "ATTENDANCE_ACTION_OUT_OF_ORDER"
      | "OVERNIGHT_ATTENDANCE_NOT_ALLOWED"
      | "ATTENDANCE_NOT_FOUND"
      | "ATTENDANCE_DATE_CONFLICT"
      | "MONTH_LOCKED";
    message: string;
    details: Record<string, unknown>;
  };
};

type AttendanceBlockedResult = AttendanceState & {
  blockedAttempt: AttendanceBlockedAttemptRecord;
};

export type AttendanceRepository = {
  findEmployeeById(employeeId: number): Promise<EmployeeAttendanceRecord | null>;
  findBranchById(branchId: number): Promise<BranchPolicyRecord | null>;
  findActiveEmployeeDeviceFingerprint(employeeId: number): Promise<string | null>;
  findOpenSession(employeeId: number): Promise<AttendanceSessionRecord | null>;
  listEmployeeSessions(employeeId: number): Promise<AttendanceSessionRecord[]>;
  createSession(input: {
    employeeId: number;
    branchId: number;
    checkInAtUtc: Date;
    checkInLatitude: number;
    checkInLongitude: number;
    checkInIpAddress: string;
    deviceId: string;
    branchPolicySnapshot: Record<string, unknown>;
  }): Promise<AttendanceSessionRecord>;
  completeSession(sessionId: number, checkOutAtUtc: Date): Promise<AttendanceSessionRecord | null>;
  createBlockedAttempt(input: {
    employeeId: number;
    branchId: number | null;
    attemptedAction: "check_in" | "check_out";
    failureReasons: string[];
    latitude: number;
    longitude: number;
    ipAddress: string;
    deviceId: string;
    branchPolicySnapshot: Record<string, unknown>;
    occurredAtUtc: Date;
  }): Promise<AttendanceBlockedAttemptRecord>;
  hasWeeklyDayOff(employeeId: number, dateKey: string): Promise<boolean>;
  hasPermissionAbsence(employeeId: number, dateKey: string): Promise<boolean>;
  isMonthLocked(monthKey: string): Promise<boolean>;
  listAdminAttendance(filters: AttendanceListFilterInput): Promise<AdminAttendanceRecord[]>;
  findAdminAttendanceById(sessionId: number): Promise<AdminAttendanceRecord | null>;
  createAdminAttendance(input: {
    employeeId: number;
    branchId: number;
    checkInAtUtc: Date;
    checkOutAtUtc: Date | null;
    reason: string;
    adminId: number;
  }): Promise<AdminAttendanceRecord>;
  updateAdminAttendance(sessionId: number, input: {
    branchId: number;
    checkInAtUtc: Date;
    checkOutAtUtc: Date | null;
    reason: string;
    adminId: number;
  }): Promise<AdminAttendanceRecord | null>;
  deleteAdminAttendance(sessionId: number): Promise<boolean>;
};

type CreateAttendanceServiceOptions = {
  repository: AttendanceRepository;
};

export function createAttendanceService(options: CreateAttendanceServiceOptions) {
  return {
    async getEmployeeAttendance(employeeId: number, now = new Date()) {
      const context = await loadAttendanceContext(options.repository, employeeId, now);

      if ("error" in context) {
        return context;
      }

      return buildAttendanceState(
        employeeId,
        context.sessions,
        context.openSession,
        context.now
      );
    },

    async recordEmployeeAction(
      employeeId: number,
      input: AttendanceActionInput,
      runtime: {
        ipAddress: string;
        occurredAtUtc?: Date;
      }
    ): Promise<AttendanceState | AttendanceBlockedResult | AttendanceErrorResult> {
      const now = runtime.occurredAtUtc ?? new Date();
      const context = await loadAttendanceContext(options.repository, employeeId, now);

      if ("error" in context) {
        return context;
      }

      if (input.action === "check_in" && context.openSession) {
        return {
          error: {
            code: "ATTENDANCE_ACTION_OUT_OF_ORDER",
            message: "Employee already has an open attendance session",
            details: {}
          }
        };
      }

      if (input.action === "check_out" && !context.openSession) {
        return {
          error: {
            code: "ATTENDANCE_ACTION_OUT_OF_ORDER",
            message: "Employee does not have an open attendance session",
            details: {}
          }
        };
      }

      if (
        input.action === "check_out" &&
        context.openSession &&
        getCairoDateKey(context.openSession.checkInAtUtc) !== getCairoDateKey(now)
      ) {
        return {
          error: {
            code: "OVERNIGHT_ATTENDANCE_NOT_ALLOWED",
            message: "Attendance check-out must happen on the same Cairo date",
            details: {}
          }
        };
      }

      const validation = await validateAttendanceAction({
        repository: options.repository,
        employeeId,
        input,
        ipAddress: runtime.ipAddress,
        now,
        branch: context.branch,
        activeDeviceFingerprint: context.activeDeviceFingerprint,
        branchPolicySnapshot: input.action === "check_out" && context.openSession
          ? context.openSession.branchPolicySnapshot
          : createBranchPolicySnapshot(context.branch)
      });

      if (validation.failureReasons.length > 0) {
        const blockedAttempt = await options.repository.createBlockedAttempt({
          employeeId,
          branchId: context.branch.id,
          attemptedAction: input.action,
          failureReasons: validation.failureReasons,
          latitude: input.latitude,
          longitude: input.longitude,
          ipAddress: runtime.ipAddress,
          deviceId: input.deviceId,
          branchPolicySnapshot: validation.branchPolicySnapshot,
          occurredAtUtc: now
        });

        return {
          ...buildAttendanceState(employeeId, context.sessions, context.openSession, now),
          blockedAttempt
        };
      }

      if (input.action === "check_in") {
        const session = await options.repository.createSession({
          employeeId,
          branchId: context.branch.id,
          checkInAtUtc: now,
          checkInLatitude: input.latitude,
          checkInLongitude: input.longitude,
          checkInIpAddress: runtime.ipAddress,
          deviceId: input.deviceId,
          branchPolicySnapshot: validation.branchPolicySnapshot
        });

        return buildAttendanceState(
          employeeId,
          [...context.sessions, session],
          session,
          now
        );
      }

      const completedSession = await options.repository.completeSession(
        context.openSession!.id,
        now
      );

      if (!completedSession) {
        return {
          error: {
            code: "ATTENDANCE_ACTION_OUT_OF_ORDER",
            message: "Employee does not have an open attendance session",
            details: {}
          }
        };
      }

      const completedSessions = context.sessions.map((session) =>
        session.id === completedSession.id ? completedSession : session
      );

      return buildAttendanceState(employeeId, completedSessions, null, now);
    },

    async listAdminAttendance(filters: AttendanceListFilterInput) {
      return options.repository.listAdminAttendance(filters);
    },

    async createAdminAttendance(input: AdminAttendanceCreateInput, adminId: number) {
      const employee = await options.repository.findEmployeeById(input.employeeId);

      if (!employee || employee.softDeletedAt !== null) {
        return createEmployeeNotFoundError();
      }

      const validation = await validateAdminAttendanceMutation(
        options.repository,
        employee.id,
        new Date(input.checkInAt),
        input.checkOutAt ? new Date(input.checkOutAt) : null
      );

      if (validation) {
        return validation;
      }

      return options.repository.createAdminAttendance({
        employeeId: input.employeeId,
        branchId: input.branchId,
        checkInAtUtc: new Date(input.checkInAt),
        checkOutAtUtc: input.checkOutAt ? new Date(input.checkOutAt) : null,
        reason: input.reason,
        adminId
      });
    },

    async updateAdminAttendance(sessionId: number, input: AdminAttendanceUpdateInput, adminId: number) {
      const existing = await options.repository.findAdminAttendanceById(sessionId);

      if (!existing) {
        return {
          error: {
            code: "ATTENDANCE_NOT_FOUND",
            message: "Attendance record not found",
            details: {}
          }
        } satisfies AttendanceErrorResult;
      }

      const validation = await validateAdminAttendanceMutation(
        options.repository,
        existing.employeeId,
        new Date(input.checkInAt),
        input.checkOutAt ? new Date(input.checkOutAt) : null
      );

      if (validation) {
        return validation;
      }

      return (await options.repository.updateAdminAttendance(sessionId, {
        branchId: input.branchId,
        checkInAtUtc: new Date(input.checkInAt),
        checkOutAtUtc: input.checkOutAt ? new Date(input.checkOutAt) : null,
        reason: input.reason,
        adminId
      })) ?? {
        error: {
          code: "ATTENDANCE_NOT_FOUND",
          message: "Attendance record not found",
          details: {}
        }
      } satisfies AttendanceErrorResult;
    },

    async deleteAdminAttendance(sessionId: number, reason: string, adminId: number) {
      void reason;
      void adminId;
      const existing = await options.repository.findAdminAttendanceById(sessionId);

      if (!existing) {
        return {
          error: {
            code: "ATTENDANCE_NOT_FOUND",
            message: "Attendance record not found",
            details: {}
          }
        } satisfies AttendanceErrorResult;
      }

      if (await options.repository.isMonthLocked(getCairoDateKey(existing.checkInAtUtc).slice(0, 7))) {
        return {
          error: {
            code: "MONTH_LOCKED",
            message: "The month is locked",
            details: {}
          }
        } satisfies AttendanceErrorResult;
      }

      await options.repository.deleteAdminAttendance(sessionId);
      return null;
    }
  };
}

async function loadAttendanceContext(
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

async function validateAttendanceAction(input: {
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

function buildAttendanceState(
  employeeId: number,
  sessions: AttendanceSessionRecord[],
  openSession: AttendanceSessionRecord | null,
  now: Date
): AttendanceState {
  const todayKey = getCairoDateKey(now);

  return {
    employeeId,
    currentAction: openSession ? "check_out" : "check_in",
    openSession,
    todaySessions: sessions.filter((session) => getCairoDateKey(session.checkInAtUtc) === todayKey)
  };
}

function createEmployeeNotFoundError(): AttendanceErrorResult {
  return {
    error: {
      code: "EMPLOYEE_NOT_FOUND",
      message: "Employee not found",
      details: {}
    }
  };
}

async function validateAdminAttendanceMutation(
  repository: AttendanceRepository,
  employeeId: number,
  checkInAtUtc: Date,
  checkOutAtUtc: Date | null
) {
  if (checkOutAtUtc && getCairoDateKey(checkInAtUtc) !== getCairoDateKey(checkOutAtUtc)) {
    return {
      error: {
        code: "OVERNIGHT_ATTENDANCE_NOT_ALLOWED",
        message: "Attendance check-out must happen on the same Cairo date",
        details: {}
      }
    } satisfies AttendanceErrorResult;
  }

  const dateKey = getCairoDateKey(checkInAtUtc);
  const monthKey = dateKey.slice(0, 7);

  if (await repository.isMonthLocked(monthKey)) {
    return {
      error: {
        code: "MONTH_LOCKED",
        message: "The month is locked",
        details: {}
      }
    } satisfies AttendanceErrorResult;
  }

  if (await repository.hasWeeklyDayOff(employeeId, dateKey)) {
    return {
      error: {
        code: "ATTENDANCE_DATE_CONFLICT",
        message: "Attendance conflicts with existing day classification",
        details: {
          conflictType: "weekly_day_off"
        }
      }
    } satisfies AttendanceErrorResult;
  }

  if (await repository.hasPermissionAbsence(employeeId, dateKey)) {
    return {
      error: {
        code: "ATTENDANCE_DATE_CONFLICT",
        message: "Attendance conflicts with existing day classification",
        details: {
          conflictType: "permission_absence"
        }
      }
    } satisfies AttendanceErrorResult;
  }

  return null;
}

function createBranchPolicySnapshot(branch: BranchPolicyRecord): Record<string, unknown> {
  return {
    branchId: branch.id,
    gpsLatitude: branch.gpsLatitude,
    gpsLongitude: branch.gpsLongitude,
    gpsRadiusMeters: branch.gpsRadiusMeters,
    allowedIpCidr: branch.allowedIpCidr,
    registeredDeviceToken: branch.registeredDeviceToken
  };
}

function getCairoDateKey(value: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(value);
}

function isAllowedDevice(
  deviceId: string,
  activeDeviceFingerprint: string | null,
  branchDeviceToken: string | null
) {
  return deviceId === activeDeviceFingerprint || deviceId === branchDeviceToken;
}

function isWithinRadiusMeters(
  latitude: number,
  longitude: number,
  targetLatitude: number,
  targetLongitude: number,
  radiusMeters: number
) {
  const toRadians = (degrees: number) => degrees * (Math.PI / 180);
  const earthRadiusMeters = 6371000;
  const latitudeDelta = toRadians(targetLatitude - latitude);
  const longitudeDelta = toRadians(targetLongitude - longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(latitude))
    * Math.cos(toRadians(targetLatitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  const distance = 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return distance <= radiusMeters;
}

function isIpInCidr(ipAddress: string, allowedIpCidr: string) {
  const normalizedIp = normalizeIpv4(ipAddress);

  if (!normalizedIp) {
    return false;
  }

  const [range, prefixText] = allowedIpCidr.split("/");
  const normalizedRange = normalizeIpv4(range ?? "");

  if (!normalizedRange) {
    return false;
  }

  const prefix = Number(prefixText ?? "32");

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const ipBits = ipv4ToInt(normalizedIp);
  const rangeBits = ipv4ToInt(normalizedRange);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return (ipBits & mask) === (rangeBits & mask);
}

function normalizeIpv4(value: string) {
  const normalized = value.replace("::ffff:", "").trim();
  const octets = normalized.split(".");

  if (octets.length !== 4) {
    return null;
  }

  const parsedOctets = octets.map((octet) => Number(octet));

  if (parsedOctets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return parsedOctets.join(".");
}

function ipv4ToInt(value: string) {
  return value
    .split(".")
    .map((octet) => Number(octet))
    .reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
}
