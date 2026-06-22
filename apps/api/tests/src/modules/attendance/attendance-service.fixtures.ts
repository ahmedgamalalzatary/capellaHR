import { expect } from "vitest";
import type { AttendanceActionInput, AttendanceListFilterInput } from "@capella/shared";
import { createAttendanceService } from "../../../../src/modules/attendance/service";
import type {
  AttendanceBlockedAttemptRecord,
  AdminAttendanceRecord,
  AttendanceRepository,
  AttendanceSessionRecord,
  BranchPolicyRecord,
  EmployeeAttendanceRecord
} from "../../../../src/modules/attendance/service";
import type { AuditLogRecord } from "../../../../src/modules/audit-logs/service";

export class InMemoryAttendanceRepository implements AttendanceRepository {
  employees = new Map<number, EmployeeAttendanceRecord>();
  branches = new Map<number, BranchPolicyRecord>();
  activeDeviceFingerprints = new Map<number, string>();
  sessions: AttendanceSessionRecord[] = [];
  blockedAttempts: AttendanceBlockedAttemptRecord[] = [];
  weeklyDayOffDates = new Set<string>();
  permissionAbsenceDates = new Set<string>();
  lockedMonths = new Set<string>();
  nextSessionId = 1;
  nextBlockedAttemptId = 1;
  adminDeletedSessionIds: number[] = [];

  async findEmployeeById(employeeId: number) {
    return this.employees.get(employeeId) ?? null;
  }

  async findBranchById(branchId: number) {
    return this.branches.get(branchId) ?? null;
  }

  async findActiveEmployeeDeviceFingerprint(employeeId: number) {
    return this.activeDeviceFingerprints.get(employeeId) ?? null;
  }

  async findOpenSession(employeeId: number) {
    return this.sessions.find((session) => session.employeeId === employeeId && session.status === "open") ?? null;
  }

  async listEmployeeSessions(employeeId: number) {
    return this.sessions
      .filter((session) => session.employeeId === employeeId)
      .sort((left, right) => left.checkInAtUtc.getTime() - right.checkInAtUtc.getTime());
  }

  async createSession(input: {
    employeeId: number;
    branchId: number;
    checkInAtUtc: Date;
    checkInLatitude: number;
    checkInLongitude: number;
    checkInIpAddress: string;
    deviceId: string;
    branchPolicySnapshot: Record<string, unknown>;
  }) {
    const session: AttendanceSessionRecord = {
      id: this.nextSessionId++,
      employeeId: input.employeeId,
      branchId: input.branchId,
      status: "open",
      checkInAtUtc: input.checkInAtUtc,
      checkOutAtUtc: null,
      checkInLatitude: input.checkInLatitude,
      checkInLongitude: input.checkInLongitude,
      checkInIpAddress: input.checkInIpAddress,
      deviceId: input.deviceId,
      branchPolicySnapshot: input.branchPolicySnapshot
    };

    this.sessions.push(session);
    return session;
  }

  async completeSession(sessionId: number, checkOutAtUtc: Date) {
    const session = this.sessions.find((item) => item.id === sessionId) ?? null;

    if (!session || session.status !== "open") {
      return null;
    }

    session.status = "completed";
    session.checkOutAtUtc = checkOutAtUtc;
    return session;
  }

  async createBlockedAttempt(input: {
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
  }) {
    const blockedAttempt: AttendanceBlockedAttemptRecord = {
      id: this.nextBlockedAttemptId++,
      employeeId: input.employeeId,
      branchId: input.branchId,
      attemptedAction: input.attemptedAction,
      failureReasons: input.failureReasons,
      latitude: input.latitude,
      longitude: input.longitude,
      ipAddress: input.ipAddress,
      deviceId: input.deviceId,
      branchPolicySnapshot: input.branchPolicySnapshot,
      occurredAtUtc: input.occurredAtUtc
    };

    this.blockedAttempts.push(blockedAttempt);
    return blockedAttempt;
  }

  async hasWeeklyDayOff(employeeId: number, dateKey: string) {
    return this.weeklyDayOffDates.has(`${employeeId}:${dateKey}`);
  }

  async hasPermissionAbsence(employeeId: number, dateKey: string) {
    return this.permissionAbsenceDates.has(`${employeeId}:${dateKey}`);
  }

  async isMonthLocked(monthKey: string) {
    return this.lockedMonths.has(monthKey);
  }

  async listAdminAttendance(filters: AttendanceListFilterInput & {
    sortBy?: "check_in_at" | "employee_name";
    sortDirection?: "asc" | "desc";
  }) {
    const employeeName = filters.employeeName?.toLowerCase();
    const dateFrom = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00.000Z`) : null;
    const dateTo = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999Z`) : null;
    const rows = this.sessions
      .filter((session) => {
        const employee = this.employees.get(session.employeeId);

        if (!employee) {
          return false;
        }

        if (employeeName && !employee.fullName.toLowerCase().includes(employeeName)) {
          return false;
        }

        if (filters.branchId && session.branchId !== filters.branchId) {
          return false;
        }

        if (filters.status && session.status !== filters.status) {
          return false;
        }

        if (dateFrom && session.checkInAtUtc < dateFrom) {
          return false;
        }

        if (dateTo && session.checkInAtUtc > dateTo) {
          return false;
        }

        return true;
      })
      .map<AdminAttendanceRecord>((session) => {
        const employee = this.employees.get(session.employeeId)!;

        return {
          ...session,
          employeeName: employee.fullName,
          adminReason: session.adminReason ?? null,
          createdByAdminId: session.createdByAdminId ?? null,
          updatedByAdminId: session.updatedByAdminId ?? null
        };
      });

    const sortBy = filters.sortBy ?? "check_in_at";
    const sortDirection = filters.sortDirection ?? "desc";
    rows.sort((left, right) => {
      const comparison = sortBy === "employee_name"
        ? left.employeeName.localeCompare(right.employeeName)
        : left.checkInAtUtc.getTime() - right.checkInAtUtc.getTime();

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return rows;
  }

  async findAdminAttendanceById(sessionId: number) {
    const session = this.sessions.find((item) => item.id === sessionId) ?? null;

    if (!session) {
      return null;
    }

    const employee = this.employees.get(session.employeeId);

    if (!employee) {
      return null;
    }

    return {
      ...session,
      employeeName: employee.fullName,
      adminReason: session.adminReason ?? null,
      createdByAdminId: session.createdByAdminId ?? null,
      updatedByAdminId: session.updatedByAdminId ?? null
    } satisfies AdminAttendanceRecord;
  }

  async createAdminAttendance(input: {
    employeeId: number;
    branchId: number;
    checkInAtUtc: Date;
    checkOutAtUtc: Date | null;
    reason: string;
    adminId: number;
  }) {
    const employee = this.employees.get(input.employeeId)!;
    const session: AttendanceSessionRecord = {
      id: this.nextSessionId++,
      employeeId: input.employeeId,
      branchId: input.branchId,
      status: input.checkOutAtUtc ? "completed" : "open",
      checkInAtUtc: input.checkInAtUtc,
      checkOutAtUtc: input.checkOutAtUtc,
      checkInLatitude: 0,
      checkInLongitude: 0,
      checkInIpAddress: "",
      deviceId: "admin",
      branchPolicySnapshot: {},
      adminReason: input.reason,
      createdByAdminId: input.adminId,
      updatedByAdminId: null
    };

    this.sessions.push(session);

    return {
      ...session,
      employeeName: employee.fullName,
      adminReason: input.reason,
      createdByAdminId: input.adminId,
      updatedByAdminId: null
    } satisfies AdminAttendanceRecord;
  }

  async updateAdminAttendance(sessionId: number, input: {
    branchId: number;
    checkInAtUtc: Date;
    checkOutAtUtc: Date | null;
    reason: string;
    adminId: number;
  }) {
    const session = this.sessions.find((item) => item.id === sessionId) ?? null;

    if (!session) {
      return null;
    }

    session.branchId = input.branchId;
    session.checkInAtUtc = input.checkInAtUtc;
    session.checkOutAtUtc = input.checkOutAtUtc;
    session.status = input.checkOutAtUtc ? "completed" : "open";
    session.adminReason = input.reason;
    session.updatedByAdminId = input.adminId;

    const employee = this.employees.get(session.employeeId)!;

    return {
      ...session,
      employeeName: employee.fullName,
      adminReason: input.reason,
      createdByAdminId: session.createdByAdminId ?? null,
      updatedByAdminId: input.adminId
    } satisfies AdminAttendanceRecord;
  }

  async deleteAdminAttendance(sessionId: number) {
    const index = this.sessions.findIndex((item) => item.id === sessionId);

    if (index === -1) {
      return false;
    }

    this.sessions.splice(index, 1);
    this.adminDeletedSessionIds.push(sessionId);
    return true;
  }
}

export class InMemoryAuditLogService {
  logs: Array<{
    adminId: number;
    actionType: string;
    entityType: string;
    entityId: string;
    entityDisplayName?: string;
    reason?: null | string;
    before?: null | Record<string, unknown>;
    after?: null | Record<string, unknown>;
  }> = [];

  async listAuditLogs() {
    return [] satisfies AuditLogRecord[];
  }

  async recordAuditLog(input: {
    adminId: number;
    actionType: string;
    entityType: string;
    entityId: string;
    entityDisplayName?: string;
    reason?: null | string;
    before?: null | Record<string, unknown>;
    after?: null | Record<string, unknown>;
  }) {
    this.logs.push(input);
    return {
      id: this.logs.length,
      adminId: input.adminId,
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId,
      entityDisplayName: input.entityDisplayName ?? null,
      reason: input.reason ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      occurredAtUtc: new Date().toISOString()
    } satisfies AuditLogRecord;
  }
}

export function createBaseRepository() {
  const repository = new InMemoryAttendanceRepository();

  repository.employees.set(1, {
    id: 1,
    fullName: "Ahmed Gamal",
    branchId: 1,
    softDeletedAt: null
  });
  repository.branches.set(1, {
    id: 1,
    setupStatus: "completed",
    gpsLatitude: "30.0444200",
    gpsLongitude: "31.2357120",
    gpsRadiusMeters: 200,
    allowedIpCidr: "192.168.1.0/24",
    registeredDeviceToken: "branch-device-1"
  });
  repository.activeDeviceFingerprints.set(1, "personal-device-1");

  return repository;
}

export function validAction(action: AttendanceActionInput["action"]): AttendanceActionInput {
  return {
    action,
    latitude: 30.04442,
    longitude: 31.235712,
    deviceId: "personal-device-1"
  };
}

export function assertAttendanceState(
  value: Awaited<ReturnType<ReturnType<typeof createAttendanceService>["recordEmployeeAction"]>>
): asserts value is {
  employeeId: number;
  currentAction: "check_in" | "check_out";
  openSession: AttendanceSessionRecord | null;
  todaySessions: AttendanceSessionRecord[];
} {
  expect("error" in value || "blockedAttempt" in value).toBe(false);
}

export function assertBlockedAttemptResult(
  value: Awaited<ReturnType<ReturnType<typeof createAttendanceService>["recordEmployeeAction"]>>
): asserts value is {
  employeeId: number;
  currentAction: "check_in" | "check_out";
  openSession: AttendanceSessionRecord | null;
  todaySessions: AttendanceSessionRecord[];
  blockedAttempt: AttendanceBlockedAttemptRecord;
} {
  expect("blockedAttempt" in value).toBe(true);
}
