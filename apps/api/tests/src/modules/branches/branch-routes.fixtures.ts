import request from "supertest";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService, createPasswordHash } from "../../../../src/modules/auth/service";
import type { BranchRecord } from "../../../../src/modules/branches/repository";
import type { BranchRepository } from "../../../../src/modules/branches/service";
import type { BranchCreateInput, BranchSearchInput, BranchUpdateInput } from "@capella/shared";

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
    return this.branches.filter((branch) => !filters.search || branch.name.toLowerCase().includes(filters.search.toLowerCase()));
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
}

export function createAdminAuthService() {
  return createAuthService({
    repository: createInMemoryAuthRepository({
      bootstrapAdmin: {
        name: "Capella Admin",
        email: "admin@capella.eg",
        password: "admin1234"
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

export async function signInAdmin(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: "admin@capella.eg",
    password: "admin1234"
  });

  return response.headers["set-cookie"];
}

export async function signInEmployee(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/sign-in").send({
    phone: "01012345678",
    password: "secret123"
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
