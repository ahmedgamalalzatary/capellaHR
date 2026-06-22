import request from "supertest";
import { createApp } from "../../../../src/app";
import { createAuthService, createPasswordHash } from "../../../../src/modules/auth/service";
import type {
  AttendanceBlockedAttemptRecord,
  AdminAttendanceRecord,
  AttendanceRepository,
  AttendanceSessionRecord,
  BranchPolicyRecord,
  EmployeeAttendanceRecord
} from "../../../../src/modules/attendance/service";

export class InMemoryAttendanceRepository implements AttendanceRepository {
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

  async applyPendingBranchAssignment() {
    return false;
  }
}

export function createBaseRepository() {
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

export function createEmployeeAuthService() {
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

export async function signInEmployee(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/sign-in").send({
    phone: "01012345678",
    password: "secret123"
  });

  return response.headers["set-cookie"];
}

export async function signInAdmin(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: "admin@capella.eg",
    password: "admin1234"
  });

  return response.headers["set-cookie"];
}
