import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createAuthService, createPasswordHash } from "../../../../src/modules/auth/service";
import { createAttendanceService } from "../../../../src/modules/attendance/service";
import type {
  AttendanceBlockedAttemptRecord,
  AdminAttendanceRecord,
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

  async listAdminAttendance() {
    return this.sessions.map<AdminAttendanceRecord>((session) => ({
      ...session,
      employeeName: this.employees.get(session.employeeId)?.fullName ?? "Unknown",
      adminReason: session.adminReason ?? null,
      createdByAdminId: session.createdByAdminId ?? null,
      updatedByAdminId: session.updatedByAdminId ?? null
    }));
  }

  async findAdminAttendanceById(sessionId: number) {
    const session = this.sessions.find((item) => item.id === sessionId) ?? null;

    if (!session) {
      return null;
    }

    return {
      ...session,
      employeeName: this.employees.get(session.employeeId)?.fullName ?? "Unknown",
      adminReason: session.adminReason ?? null,
      createdByAdminId: session.createdByAdminId ?? null,
      updatedByAdminId: session.updatedByAdminId ?? null
    };
  }

  async createAdminAttendance(input: {
    employeeId: number;
    branchId: number;
    checkInAtUtc: Date;
    checkOutAtUtc: Date | null;
    reason: string;
    adminId: number;
  }) {
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
      employeeName: this.employees.get(input.employeeId)?.fullName ?? "Unknown",
      adminReason: input.reason,
      createdByAdminId: input.adminId,
      updatedByAdminId: null
    };
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

    return {
      ...session,
      employeeName: this.employees.get(session.employeeId)?.fullName ?? "Unknown",
      adminReason: input.reason,
      createdByAdminId: session.createdByAdminId ?? null,
      updatedByAdminId: input.adminId
    };
  }

  async deleteAdminAttendance(sessionId: number) {
    const index = this.sessions.findIndex((item) => item.id === sessionId);

    if (index === -1) {
      return false;
    }

    this.sessions.splice(index, 1);
    return true;
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

  it("returns forbidden on admin attendance routes for employee sessions", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });
    const employeeCookie = await signInEmployee(app);

    const response = await request(app).get("/admin/attendance").set("Cookie", employeeCookie);

    expect(response.status).toBe(403);
  });

  it("lists admin attendance for admin sessions", async () => {
    const repository = createBaseRepository();
    repository.sessions.push({
      id: 1,
      employeeId: 2,
      branchId: 1,
      status: "completed",
      checkInAtUtc: new Date("2026-06-22T06:00:00.000Z"),
      checkOutAtUtc: new Date("2026-06-22T12:00:00.000Z"),
      checkInLatitude: 0,
      checkInLongitude: 0,
      checkInIpAddress: "",
      deviceId: "admin",
      branchPolicySnapshot: {},
      adminReason: "manual correction",
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({ repository })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app).get("/admin/attendance").set("Cookie", adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.sessions).toHaveLength(1);
    expect(response.body.sessions[0].employeeName).toBe("Test Employee");
  });

  it("creates admin attendance with a required reason", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .post("/admin/attendance")
      .set("Cookie", adminCookie)
      .send({
        employeeId: 2,
        branchId: 1,
        checkInAt: "2026-06-22T08:00:00.000Z",
        checkOutAt: "2026-06-22T16:00:00.000Z",
        reason: "manual correction"
      });

    expect(response.status).toBe(201);
    expect(response.body.session.status).toBe("completed");
  });

  it("updates admin attendance", async () => {
    const repository = createBaseRepository();
    repository.sessions.push({
      id: 1,
      employeeId: 2,
      branchId: 1,
      status: "completed",
      checkInAtUtc: new Date("2026-06-22T06:00:00.000Z"),
      checkOutAtUtc: new Date("2026-06-22T12:00:00.000Z"),
      checkInLatitude: 0,
      checkInLongitude: 0,
      checkInIpAddress: "",
      deviceId: "admin",
      branchPolicySnapshot: {},
      adminReason: "before",
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({ repository })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .patch("/admin/attendance/1")
      .set("Cookie", adminCookie)
      .send({
        branchId: 1,
        checkInAt: "2026-06-22T09:00:00.000Z",
        checkOutAt: "2026-06-22T17:00:00.000Z",
        reason: "manual correction"
      });

    expect(response.status).toBe(200);
    expect(response.body.session.adminReason).toBe("manual correction");
  });

  it("deletes admin attendance", async () => {
    const repository = createBaseRepository();
    repository.sessions.push({
      id: 1,
      employeeId: 2,
      branchId: 1,
      status: "completed",
      checkInAtUtc: new Date("2026-06-22T06:00:00.000Z"),
      checkOutAtUtc: new Date("2026-06-22T12:00:00.000Z"),
      checkInLatitude: 0,
      checkInLongitude: 0,
      checkInIpAddress: "",
      deviceId: "admin",
      branchPolicySnapshot: {},
      adminReason: "manual correction",
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({ repository })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .delete("/admin/attendance/1")
      .set("Cookie", adminCookie)
      .send({
        reason: "remove duplicate"
      });

    expect(response.status).toBe(204);
  });
});

function createBaseRepository() {
  const repository = new InMemoryAttendanceRepository();

  repository.employees.set(2, {
    id: 2,
    fullName: "Test Employee",
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
