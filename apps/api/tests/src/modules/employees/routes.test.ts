import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService, createPasswordHash } from "../../../../src/modules/auth/service";
import { createEmployeeService } from "../../../../src/modules/employees/service";
import type { EmployeeFileInput, EmployeeFileStorage } from "../../../../src/modules/employees/service";

function createStubEmployeeService(branchSetupStatus: "completed" | "setup_pending") {
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

describe("employee routes", () => {
  it("returns unauthorized for employee routes without an admin session", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("completed").service
    });

    const response = await request(app).get("/employees");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
        details: {}
      }
    });
  });

  it("returns forbidden for employee routes with an employee session", async () => {
    const authService = createEmployeeAuthService();
    const app = createApp({
      authService,
      employeeService: createStubEmployeeService("completed").service
    });

    const signInResponse = await request(app).post("/auth/sign-in").send({
      phone: "01012345678",
      password: "secret123"
    });
    const cookieHeader = signInResponse.headers["set-cookie"];

    const response = await request(app).get("/employees").set("Cookie", cookieHeader);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Admin access required",
        details: {}
      }
    });
  });

  it("rejects invalid employee creation payloads with the project error shape", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .post("/employees")
      .set("Cookie", cookieHeader)
      .field("fullName", "")
      .field("password", "short");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details: expect.any(Object)
      }
    });
  });

  it("rejects employee creation for setup pending branches", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("setup_pending").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await attachRequiredFiles(
      buildMultipartEmployeeRequest(request(app).post("/employees").set("Cookie", cookieHeader), validPayload())
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: "BRANCH_NOT_ASSIGNABLE",
        message: "Employees can only be assigned to completed branches",
        details: {}
      }
    });
  });

  it("creates an employee for completed branches", async () => {
    const employeeService = createStubEmployeeService("completed");
    const app = createApp({
      authService: createCustomAdminAuthService(7),
      employeeService: employeeService.service
    });
    const cookieHeader = await signInAdmin(app, {
      email: "admin7@capella.eg",
      password: "admin1234"
    });

    const response = await attachRequiredFiles(
      buildMultipartEmployeeRequest(request(app).post("/employees").set("Cookie", cookieHeader), validPayload())
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      employee: {
        id: 1,
        fullName: "Mina Adel",
        primaryPhone: "01012345678",
        whatsappPhone: "01012345679",
        email: "mina@capella.eg",
        branchId: 1,
        age: 28,
        address: "Cairo",
        currentMonthlySalary: "10000",
        softDeletedAt: null
      }
    });
    expect(employeeService.state.lastCreatedByAdminId).toBe(7);
  });

  it("rejects employee creation when the required files are missing", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await buildMultipartEmployeeRequest(
      request(app).post("/employees").set("Cookie", cookieHeader),
      validPayload()
    ).attach("personalPhoto", Buffer.from("photo"), "photo.jpg");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "MISSING_EMPLOYEE_FILES",
        message: "Employee files are required",
        details: {
          missingFileTypes: ["id_front", "id_back"]
        }
      }
    });
  });

  it("lists employees using the shared query filter contract", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).get("/employees").set("Cookie", cookieHeader).query({
      search: "Mina",
      branchId: "1",
      status: "active"
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      employees: [
        {
          id: 1,
          fullName: "Mina Adel",
          primaryPhone: "01012345678",
          whatsappPhone: "01012345679",
          email: "mina@capella.eg",
          branchId: 1,
          age: 28,
          address: "Cairo",
          currentMonthlySalary: "10000",
          softDeletedAt: null
        }
      ]
    });
  });

  it("returns a single employee by id", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).get("/employees/1").set("Cookie", cookieHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      employee: {
        id: 1,
        fullName: "Mina Adel",
        primaryPhone: "01012345678",
        whatsappPhone: "01012345679",
        email: "mina@capella.eg",
        branchId: 1,
        age: 28,
        address: "Cairo",
        currentMonthlySalary: "10000",
        softDeletedAt: null
      }
    });
  });

  it("returns not found for a missing employee id", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).get("/employees/999").set("Cookie", cookieHeader);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "EMPLOYEE_NOT_FOUND",
        message: "Employee not found",
        details: {}
      }
    });
  });

  it("updates an employee", async () => {
    const employeeService = createStubEmployeeService("completed");
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: employeeService.service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).patch("/employees/1").set("Cookie", cookieHeader).send({
      fullName: "Updated Mina",
      currentMonthlySalary: "12000"
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      employee: {
        id: 1,
        fullName: "Updated Mina",
        primaryPhone: "01012345678",
        whatsappPhone: "01012345679",
        email: "mina@capella.eg",
        branchId: 1,
        age: 28,
        address: "Cairo",
        currentMonthlySalary: "12000",
        softDeletedAt: null
      }
    });
    expect(employeeService.state.lastUpdatedByAdminId).toBe(1);
  });

  it("returns validation errors for invalid employee updates", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).patch("/employees/1").set("Cookie", cookieHeader).send({
      password: "short"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details: expect.any(Object)
      }
    });
  });

  it("returns conflict errors for duplicate employee updates", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).patch("/employees/1").set("Cookie", cookieHeader).send({
      email: "duplicate@capella.eg"
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: "EMPLOYEE_CONFLICT",
        message: "Employee email must be unique",
        details: {
          field: "email"
        }
      }
    });
  });

  it("soft deletes an employee", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).delete("/employees/1").set("Cookie", cookieHeader);

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
  });

  it("lists the current employee files", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).get("/employees/1/files").set("Cookie", cookieHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      files: [
        {
          id: 1,
          fileType: "personal_photo",
          mimeType: "image/jpeg",
          fileSizeBytes: 12,
          replacedAt: null
        }
      ]
    });
  });

  it("downloads an employee file", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).get("/employees/1/files/1").set("Cookie", cookieHeader);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.body).toEqual(Buffer.from("file-bytes"));
  });

  it("replaces an employee file", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .put("/employees/1/files/personal_photo")
      .set("Cookie", cookieHeader)
      .attach("file", Buffer.from("replacement"), "replacement.jpg");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      file: {
        id: 2,
        fileType: "personal_photo",
        mimeType: "image/jpeg",
        fileSizeBytes: 11,
        replacedAt: null
      }
    });
  });
});

function validPayload() {
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

function createAdminAuthService() {
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

function createCustomAdminAuthService(adminId: number) {
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

async function signInAdmin(app: ReturnType<typeof createApp>, credentials?: { email: string; password: string }) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: credentials?.email ?? "admin@capella.eg",
    password: credentials?.password ?? "admin1234"
  });

  return response.headers["set-cookie"];
}

class InMemoryEmployeeFileStorage implements EmployeeFileStorage {
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

function buildMultipartEmployeeRequest(
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

function attachRequiredFiles(requestBuilder: request.Test) {
  return requestBuilder
    .attach("personalPhoto", Buffer.from("photo"), "photo.jpg")
    .attach("idFront", Buffer.from("front"), "front.jpg")
    .attach("idBack", Buffer.from("back"), "back.jpg");
}
