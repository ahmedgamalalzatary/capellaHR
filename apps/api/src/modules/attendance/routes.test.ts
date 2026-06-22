import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { createAuthService, createPasswordHash } from "../auth/service";
import { createAttendanceService } from "./service";
import type {
  AttendanceBlockedAttemptRecord,
  AttendanceRepository,
  AttendanceSessionRecord,
  BranchPolicyRecord,
  EmployeeAttendanceRecord
} from "./service";

class InMemoryAttendanceRepository implements AttendanceRepository {
  employees = new Map<number, EmployeeAttendanceRecord>();
  branches = new Map<number, BranchPolicyRecord>();
  activeDeviceFingerprints = new Map<number, string>();
  sessions: AttendanceSessionRecord[] = [];
  blockedAttempts: AttendanceBlockedAttemptRecord[] = [];
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
    return this.sessions.filter((session) => session.employeeId === employeeId);
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

    if (!session) {
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

  async hasWeeklyDayOff() {
    return false;
  }

  async hasPermissionAbsence() {
    return false;
  }

  async isMonthLocked() {
    return false;
  }
}

describe("attendance routes", () => {
  it("returns unauthorized on employee attendance routes without a session", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });

    const response = await request(app).get("/attendance/me");

    expect(response.status).toBe(401);
  });

  it("returns forbidden on employee attendance routes for admin sessions", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app).get("/attendance/me").set("Cookie", adminCookie);

    expect(response.status).toBe(403);
  });

  it("returns the current employee attendance state", async () => {
    const repository = createBaseRepository();
    repository.sessions.push({
      id: 1,
      employeeId: 2,
      branchId: 1,
      status: "open",
      checkInAtUtc: new Date("2026-06-22T06:00:00.000Z"),
      checkOutAtUtc: null,
      checkInLatitude: 30.04442,
      checkInLongitude: 31.235712,
      checkInIpAddress: "192.168.1.42",
      deviceId: "personal-device-1",
      branchPolicySnapshot: {
        allowedIpCidr: "192.168.1.0/24"
      }
    });

    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({ repository })
    });
    const employeeCookie = await signInEmployee(app);

    const response = await request(app).get("/attendance/me").set("Cookie", employeeCookie);

    expect(response.status).toBe(200);
    expect(response.body.attendance.currentAction).toBe("check_out");
    expect(response.body.attendance.todaySessions).toHaveLength(1);
  });

  it("records an employee check-in", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });
    const employeeCookie = await signInEmployee(app);

    const response = await request(app)
      .post("/attendance/action")
      .set("Cookie", employeeCookie)
      .set("X-Forwarded-For", "192.168.1.42")
      .send({
        action: "check_in",
        latitude: 30.04442,
        longitude: 31.235712,
        deviceId: "personal-device-1"
      });

    expect(response.status).toBe(200);
    expect(response.body.attendance.currentAction).toBe("check_out");
  });

  it("returns blocked validation attempts without losing the attendance state payload", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });
    const employeeCookie = await signInEmployee(app);

    const response = await request(app)
      .post("/attendance/action")
      .set("Cookie", employeeCookie)
      .set("X-Forwarded-For", "10.0.0.10")
      .send({
        action: "check_in",
        latitude: 29,
        longitude: 31,
        deviceId: "unknown-device"
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toEqual({
      code: "ATTENDANCE_VALIDATION_FAILED",
      message: "Attendance validation failed",
      details: {
        failureReasons: ["device_not_allowed", "gps_out_of_range", "ip_not_allowed"]
      }
    });
    expect(response.body.attendance.currentAction).toBe("check_in");
  });
});

function createBaseRepository() {
  const repository = new InMemoryAttendanceRepository();

  repository.employees.set(2, {
    id: 2,
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
  repository.activeDeviceFingerprints.set(2, "personal-device-1");

  return repository;
}

function createEmployeeAuthService() {
  const sessions = new Map<string, {
    tokenHash: string;
    actorId: number;
    actorRole: "admin" | "employee";
    expiresAt: Date;
    revokedAt: Date | null;
  }>();

  return createAuthService({
    repository: {
      async findAdminByEmail(email: string) {
        if (email !== "admin@capella.eg") {
          return null;
        }

        return {
          id: 1,
          name: "Capella Admin",
          email: "admin@capella.eg",
          passwordHash: createPasswordHash("admin1234")
        };
      },
      async findAdminById(id: number) {
        if (id !== 1) {
          return null;
        }

        return {
          id: 1,
          name: "Capella Admin",
          email: "admin@capella.eg",
          passwordHash: createPasswordHash("admin1234")
        };
      },
      async findEmployeeByPhone(phone: string) {
        if (phone !== "01012345678") {
          return null;
        }

        return {
          id: 2,
          fullName: "Test Employee",
          primaryPhone: "01012345678",
          passwordHash: createPasswordHash("secret123"),
          softDeletedAt: null
        };
      },
      async findEmployeeById(id: number) {
        if (id !== 2) {
          return null;
        }

        return {
          id: 2,
          fullName: "Test Employee",
          primaryPhone: "01012345678",
          passwordHash: createPasswordHash("secret123"),
          softDeletedAt: null
        };
      },
      async insertSession(session) {
        sessions.set(session.tokenHash, session);
      },
      async findSessionByTokenHash(tokenHash) {
        return sessions.get(tokenHash) ?? null;
      },
      async revokeSessionByTokenHash(tokenHash, revokedAt) {
        const session = sessions.get(tokenHash);

        if (!session) {
          return false;
        }

        sessions.set(tokenHash, {
          ...session,
          revokedAt
        });

        return true;
      },
      async revokeActiveSessionsForActor() {}
    },
    adminSessionTtlHours: 8,
    employeeSessionTtlHours: 12
  });
}

async function signInEmployee(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/sign-in").send({
    phone: "01012345678",
    password: "secret123"
  });

  return response.headers["set-cookie"];
}

async function signInAdmin(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: "admin@capella.eg",
    password: "admin1234"
  });

  return response.headers["set-cookie"];
}
