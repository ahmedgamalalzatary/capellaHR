import { describe, expect, it } from "vitest";
import type { AttendanceActionInput } from "@capella/shared";
import { createAttendanceService } from "../../../../src/modules/attendance/service";
import type {
  AttendanceBlockedAttemptRecord,
  AttendanceRepository,
  AttendanceSessionRecord,
  BranchPolicyRecord,
  EmployeeAttendanceRecord
} from "../../../../src/modules/attendance/service";

class InMemoryAttendanceRepository implements AttendanceRepository {
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
}

describe("attendance service", () => {
  it("creates an open attendance session when check-in passes device, gps, and ip validation", async () => {
    const repository = createBaseRepository();
    const service = createAttendanceService({ repository });

    const result = await service.recordEmployeeAction(1, validAction("check_in"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T06:00:00.000Z")
    });

    assertAttendanceState(result);
    expect(result.currentAction).toBe("check_out");
    expect(result.openSession?.status).toBe("open");
    expect(result.todaySessions).toHaveLength(1);
  });

  it("stores a blocked attempt when attendance validation fails", async () => {
    const repository = createBaseRepository();
    const service = createAttendanceService({ repository });

    const result = await service.recordEmployeeAction(1, {
      action: "check_in",
      latitude: 29.0,
      longitude: 31.0,
      deviceId: "unknown-device"
    }, {
      ipAddress: "10.0.0.10",
      occurredAtUtc: new Date("2026-06-22T06:00:00.000Z")
    });

    assertBlockedAttemptResult(result);
    expect(result.blockedAttempt.failureReasons).toEqual([
      "device_not_allowed",
      "gps_out_of_range",
      "ip_not_allowed"
    ]);
    expect(repository.blockedAttempts).toHaveLength(1);
    expect(result.currentAction).toBe("check_in");
  });

  it("completes the open attendance session on check-out within the same Cairo day", async () => {
    const repository = createBaseRepository();
    const service = createAttendanceService({ repository });
    const checkIn = await service.recordEmployeeAction(1, validAction("check_in"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T06:00:00.000Z")
    });
    assertAttendanceState(checkIn);

    const checkOut = await service.recordEmployeeAction(1, validAction("check_out"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T12:00:00.000Z")
    });

    assertAttendanceState(checkOut);
    expect(checkOut.currentAction).toBe("check_in");
    expect(checkOut.openSession).toBeNull();
    expect(checkOut.todaySessions[0]?.status).toBe("completed");
    expect(checkOut.todaySessions[0]?.checkOutAtUtc).toEqual(new Date("2026-06-22T12:00:00.000Z"));
  });

  it("rejects a second check-in while a session is still open", async () => {
    const repository = createBaseRepository();
    const service = createAttendanceService({ repository });
    await service.recordEmployeeAction(1, validAction("check_in"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T06:00:00.000Z")
    });

    const result = await service.recordEmployeeAction(1, validAction("check_in"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T07:00:00.000Z")
    });

    expect(result).toEqual({
      error: {
        code: "ATTENDANCE_ACTION_OUT_OF_ORDER",
        message: "Employee already has an open attendance session",
        details: {}
      }
    });
  });

  it("blocks attendance on a weekly day off", async () => {
    const repository = createBaseRepository();
    repository.weeklyDayOffDates.add("1:2026-06-22");
    const service = createAttendanceService({ repository });

    const result = await service.recordEmployeeAction(1, validAction("check_in"), {
      ipAddress: "192.168.1.42",
      occurredAtUtc: new Date("2026-06-22T06:00:00.000Z")
    });

    assertBlockedAttemptResult(result);
    expect(result.blockedAttempt.failureReasons).toEqual(["weekly_day_off"]);
  });
});

function createBaseRepository() {
  const repository = new InMemoryAttendanceRepository();

  repository.employees.set(1, {
    id: 1,
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

function validAction(action: AttendanceActionInput["action"]): AttendanceActionInput {
  return {
    action,
    latitude: 30.04442,
    longitude: 31.235712,
    deviceId: "personal-device-1"
  };
}

function assertAttendanceState(
  value: Awaited<ReturnType<ReturnType<typeof createAttendanceService>["recordEmployeeAction"]>>
): asserts value is {
  employeeId: number;
  currentAction: "check_in" | "check_out";
  openSession: AttendanceSessionRecord | null;
  todaySessions: AttendanceSessionRecord[];
} {
  expect("error" in value || "blockedAttempt" in value).toBe(false);
}

function assertBlockedAttemptResult(
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
