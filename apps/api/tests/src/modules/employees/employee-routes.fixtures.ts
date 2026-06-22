import request from "supertest";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService, createPasswordHash } from "../../../../src/modules/auth/service";
import { createEmployeeService } from "../../../../src/modules/employees/service";
import type { EmployeeFileInput, EmployeeFileStorage } from "../../../../src/modules/employees/service";

export function createStubEmployeeService(branchSetupStatus: "completed" | "setup_pending") {
  const fileStorage = new InMemoryEmployeeFileStorage();
  const state = {
    lastCreatedByAdminId: null as number | null,
    lastUpdatedByAdminId: null as number | null,
    lastReplacedByAdminId: null as number | null
  };

  const service = createEmployeeService({
    repository: {
      async findBranchSetupStatus() {
        return branchSetupStatus;
      },
      async createEmployee(input) {
        state.lastCreatedByAdminId = input.createdByAdminId;
        return {
          id: 1,
          fullName: input.fullName,
          passwordHash: input.passwordHash,
          primaryPhone: input.primaryPhone,
          whatsappPhone: input.whatsappPhone,
          email: input.email ?? null,
          branchId: input.branchId,
          age: input.age,
          address: input.address,
          currentMonthlySalary: input.currentMonthlySalary,
          softDeletedAt: null
        };
      },
      async listEmployees() {
        return [
          {
            id: 1,
            fullName: "Mina Adel",
            passwordHash: "plain:secret123",
            primaryPhone: "01012345678",
            whatsappPhone: "01012345679",
            email: "mina@capella.eg",
            branchId: 1,
            age: 28,
            address: "Cairo",
            currentMonthlySalary: "10000",
            softDeletedAt: null
          }
        ];
      },
      async findEmployeeById(employeeId) {
        if (employeeId !== 1) {
          return null;
        }

        return {
          id: 1,
          fullName: "Mina Adel",
          passwordHash: "plain:secret123",
          primaryPhone: "01012345678",
          whatsappPhone: "01012345679",
          email: "mina@capella.eg",
          branchId: 1,
          age: 28,
          address: "Cairo",
          currentMonthlySalary: "10000",
          softDeletedAt: null
        };
      },
      async updateEmployee(employeeId, input, updatedByAdminId) {
        if (employeeId !== 1) {
          return null;
        }

        state.lastUpdatedByAdminId = updatedByAdminId;

        if (input.email === "duplicate@capella.eg") {
          return {
            error: {
              code: "EMPLOYEE_CONFLICT",
              field: "email"
            }
          };
        }

        return {
          id: 1,
          fullName: input.fullName ?? "Mina Adel",
          passwordHash: input.passwordHash ?? "plain:secret123",
          primaryPhone: input.primaryPhone ?? "01012345678",
          whatsappPhone: input.whatsappPhone ?? "01012345679",
          email: input.email ?? "mina@capella.eg",
          branchId: input.branchId ?? 1,
          age: input.age ?? 28,
          address: input.address ?? "Cairo",
          currentMonthlySalary: input.currentMonthlySalary ?? "10000",
          softDeletedAt: null
        };
      },
      async softDeleteEmployee(employeeId) {
        return employeeId === 1;
      },
      async insertEmployeeFiles(employeeId, files) {
        return files.map((file, index) => ({
          id: index + 1,
          employeeId,
          fileType: file.fileType,
          storagePath: file.storagePath,
          mimeType: file.mimeType,
          fileSizeBytes: file.fileSizeBytes,
          replacedAt: null
        }));
      },
      async listEmployeeFiles(employeeId) {
        if (employeeId !== 1) {
          return [];
        }

        return [
          {
            id: 1,
            employeeId: 1,
            fileType: "personal_photo",
            storagePath: "employees/1/personal_photo/1.jpg",
            mimeType: "image/jpeg",
            fileSizeBytes: 12,
            replacedAt: null
          }
        ];
      },
      async findEmployeeFileById(employeeId, fileId) {
        if (employeeId !== 1 || fileId !== 1) {
          return null;
        }

        return {
          id: 1,
          employeeId: 1,
          fileType: "personal_photo",
          storagePath: "employees/1/personal_photo/1.jpg",
          mimeType: "image/jpeg",
          fileSizeBytes: 12,
          replacedAt: null
        };
      },
      async replaceEmployeeFile(employeeId, fileType, file) {
        if (employeeId !== 1) {
          return null;
        }

        return {
          id: 2,
          employeeId: 1,
          fileType,
          storagePath: file.storagePath,
          mimeType: file.mimeType,
          fileSizeBytes: file.fileSizeBytes,
          replacedAt: null
        };
      }
    },
    fileStorage
  });

  return {
    service,
    state
  };
}

export function validPayload() {
  return {
    fullName: "Mina Adel",
    password: "secret123",
    primaryPhone: "01012345678",
    whatsappPhone: "01012345679",
    email: "mina@capella.eg",
    branchId: 1,
    age: 28,
    address: "Cairo",
    currentMonthlySalary: "10000"
  };
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

export function createCustomAdminAuthService(adminId: number) {
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
        if (email !== "admin7@capella.eg") {
          return null;
        }

        return {
          id: adminId,
          name: "Capella Admin 7",
          email: "admin7@capella.eg",
          passwordHash: createPasswordHash("admin1234")
        };
      },
      async findAdminById(id: number) {
        if (id !== adminId) {
          return null;
        }

        return {
          id,
          name: "Capella Admin 7",
          email: "admin7@capella.eg",
          passwordHash: createPasswordHash("admin1234")
        };
      },
      async findEmployeeByPhone() {
        return null;
      },
      async findEmployeeById() {
        return null;
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

export async function signInAdmin(app: ReturnType<typeof createApp>, credentials?: { email: string; password: string }) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: credentials?.email ?? "admin@capella.eg",
    password: credentials?.password ?? "admin1234"
  });

  return response.headers["set-cookie"];
}

export class InMemoryEmployeeFileStorage implements EmployeeFileStorage {
  async saveEmployeeFile(employeeId: number, file: EmployeeFileInput) {
    return {
      storagePath: `employees/${employeeId}/${file.fileType}/saved.jpg`,
      mimeType: file.mimeType,
      fileSizeBytes: file.sizeBytes
    };
  }

  async readEmployeeFile() {
    return Buffer.from("file-bytes");
  }
}

export function buildMultipartEmployeeRequest(
  requestBuilder: request.Test,
  payload: ReturnType<typeof validPayload>
) {
  return requestBuilder
    .field("fullName", payload.fullName)
    .field("password", payload.password)
    .field("primaryPhone", payload.primaryPhone)
    .field("whatsappPhone", payload.whatsappPhone)
    .field("email", payload.email)
    .field("branchId", String(payload.branchId))
    .field("age", String(payload.age))
    .field("address", payload.address)
    .field("currentMonthlySalary", payload.currentMonthlySalary);
}

export function attachRequiredFiles(requestBuilder: request.Test) {
  return requestBuilder
    .attach("personalPhoto", Buffer.from("photo"), "photo.jpg")
    .attach("idFront", Buffer.from("front"), "front.jpg")
    .attach("idBack", Buffer.from("back"), "back.jpg");
}
