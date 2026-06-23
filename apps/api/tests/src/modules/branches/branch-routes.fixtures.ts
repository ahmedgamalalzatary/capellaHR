import request from "supertest";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService, createPasswordHash } from "../../../../src/modules/auth/service";
import type { BranchRecord } from "../../../../src/modules/branches/repository";
import type { BranchRepository } from "../../../../src/modules/branches/service";
import type {
  BranchCreateInput,
  BranchSearchInput,
  BranchSetupCompletionInput,
  BranchSetupLinkCreateInput,
  BranchUpdateInput
} from "@capella/shared";

export class InMemoryBranchRepository implements BranchRepository {
  branches: BranchRecord[] = [
    {
      id: 1,
      name: "Nasr City",
      address: "Cairo",
      gpsLatitude: "30.0500000",
      gpsLongitude: "31.2500000",
      gpsRadiusMeters: 100,
      allowedIpCidr: "192.168.1.0/24",
      registeredDeviceToken: null,
      setupStatus: "completed" as const
    }
  ];
  setupLinks: Array<{
    id: number;
    branchId: number;
    token: string;
    deviceLabel: string | null;
    status: "active" | "used" | "revoked" | "expired";
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
    createdByAdminId: number;
  }> = [];
  deviceRegistrations: Array<{
    id: number;
    branchId: number;
    deviceToken: string;
    deviceLabel: string | null;
    browserFingerprint: string | null;
    status: "pending" | "active" | "revoked" | "replaced";
    registeredAt: Date | null;
    revokedAt: Date | null;
    replacedAt: Date | null;
  }> = [];
  nextSetupLinkId = 1;
  nextRegistrationId = 1;

  async createBranch(input: BranchCreateInput) {
    const branch = {
      id: 2,
      name: input.name,
      address: input.address,
      gpsLatitude: input.gpsLatitude,
      gpsLongitude: input.gpsLongitude,
      gpsRadiusMeters: input.gpsRadiusMeters,
      allowedIpCidr: input.allowedIpCidr,
      registeredDeviceToken: null,
      setupStatus: input.setupStatus
    };

    this.branches.push(branch);
    return branch;
  }

  async listBranches(filters: BranchSearchInput) {
    const filtered = this.branches.filter((branch) => !filters.search || branch.name.toLowerCase().includes(filters.search.toLowerCase()));
    const offset = (filters.page - 1) * filters.pageSize;

    return {
      items: filtered.slice(offset, offset + filters.pageSize),
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / filters.pageSize))
      }
    };
  }

  async findBranchById(branchId: number) {
    return this.branches.find((branch) => branch.id === branchId) ?? null;
  }

  async updateBranch(branchId: number, input: BranchUpdateInput) {
    const branch = this.branches.find((item) => item.id === branchId);

    if (!branch) {
      return null;
    }

    Object.assign(branch, Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)));
    return branch;
  }

  async findActiveRegistration(branchId: number) {
    return this.deviceRegistrations.find((item) => item.branchId === branchId && item.status === "active") ?? null;
  }

  async findPendingSetupLink(branchId: number) {
    return this.setupLinks.find((item) => item.branchId === branchId && item.status === "active") ?? null;
  }

  async createSetupLink(input: {
    branchId: number;
    token: string;
    deviceLabel?: string;
    expiresAt: Date;
    createdByAdminId: number;
  }) {
    const link = {
      id: this.nextSetupLinkId++,
      branchId: input.branchId,
      token: input.token,
      deviceLabel: input.deviceLabel ?? null,
      status: "active" as const,
      expiresAt: input.expiresAt,
      usedAt: null,
      revokedAt: null,
      createdByAdminId: input.createdByAdminId
    };
    this.setupLinks.push(link);
    return link;
  }

  async findPendingSetupLinkByToken(token: string) {
    return this.setupLinks.find((item) => item.token === token && item.status === "active") ?? null;
  }

  async revokePendingSetupLinks(branchId: number, revokedAt: Date) {
    this.setupLinks.forEach((item) => {
      if (item.branchId === branchId && item.status === "active") {
        item.status = "revoked";
        item.revokedAt = revokedAt;
      }
    });
  }

  async activateSetupLink(token: string, input: {
    deviceLabel?: string;
    browserFingerprint: string;
    registeredAt: Date;
  }) {
    const link = this.setupLinks.find((item) => item.token === token && item.status === "active") ?? null;

    if (!link) {
      return null;
    }

    link.status = "used";
    link.usedAt = input.registeredAt;

    const registration = {
      id: this.nextRegistrationId++,
      branchId: link.branchId,
      deviceToken: token,
      deviceLabel: input.deviceLabel ?? link.deviceLabel,
      browserFingerprint: input.browserFingerprint,
      status: "active" as const,
      registeredAt: input.registeredAt,
      revokedAt: null,
      replacedAt: null
    };
    this.deviceRegistrations.push(registration);

    const branch = this.branches.find((item) => item.id === link.branchId);
    if (branch) {
      branch.setupStatus = "completed";
      branch.registeredDeviceToken = token;
    }

    return registration;
  }

  async replaceActiveRegistrations(branchId: number, keepRegistrationId: number, replacedAt: Date) {
    this.deviceRegistrations.forEach((item) => {
      if (item.branchId === branchId && item.status === "active" && item.id !== keepRegistrationId) {
        item.status = "replaced";
        item.revokedAt = replacedAt;
        item.replacedAt = replacedAt;
      }
    });
  }
}

export function createAdminAuthService() {
  return createAuthService({
    repository: createInMemoryAuthRepository({
      bootstrapAdmin: {
        name: "Capella Admin",
        email: "admin.test@capella.invalid",
        password: "test-admin-pass-123"
      }
    }),
    adminSessionTtlHours: 8,
    employeeSessionTtlHours: 12
  });
}

export function createEmployeeAuthService() {
  const sessions = new Map();

  return createAuthService({
    repository: {
      async findAdminByEmail() {
        return null;
      },
      async findAdminById() {
        return null;
      },
      async findEmployeeByPhone(phone: string) {
        if (phone !== "01012345678") {
          return null;
        }

        return {
          id: 2,
          fullName: "Test Employee",
          primaryPhone: "01012345678",
          passwordHash: createPasswordHash("test-employee-pass-123"),
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
          passwordHash: createPasswordHash("test-employee-pass-123"),
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

export async function signInAdmin(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: "admin.test@capella.invalid",
    password: "test-admin-pass-123"
  });

  return response.headers["set-cookie"];
}

export async function signInEmployee(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/sign-in").send({
    phone: "01012345678",
    password: "test-employee-pass-123"
  });

  return response.headers["set-cookie"];
}

export function validPayload(): BranchCreateInput {
  return {
    name: "Heliopolis",
    address: "Cairo",
    gpsLatitude: "30.1000000",
    gpsLongitude: "31.3000000",
    gpsRadiusMeters: 150,
    allowedIpCidr: "192.168.10.0/24",
    setupStatus: "setup_pending"
  };
}

export function validBranchSetupLinkInput(): BranchSetupLinkCreateInput {
  return {
    deviceLabel: "Reception iPad"
  };
}

export function validBranchSetupCompletionInput(): BranchSetupCompletionInput {
  return {
    browserFingerprint: "branch-browser"
  };
}

export function assertBranchDeviceState(
  value: Awaited<ReturnType<ReturnType<typeof import("../../../../src/modules/branches/service").createBranchService>["createSetupLink"]>>
    | Awaited<ReturnType<ReturnType<typeof import("../../../../src/modules/branches/service").createBranchService>["completeSetup"]>>
): asserts value is {
  branch: BranchRecord;
  activeDevice: {
    id: number;
    deviceToken: string;
    deviceLabel: string | null;
    browserFingerprint: string | null;
    registeredAt: Date | null;
  } | null;
  pendingSetup: {
    id: number;
    token: string;
    deviceLabel: string | null;
    expiresAt: Date;
  } | null;
} {
  if ("error" in value) {
    throw new Error("Expected branch device state");
  }
}
