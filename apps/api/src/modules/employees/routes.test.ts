import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { createEmployeeService } from "./service";
import type { EmployeeFileInput, EmployeeFileStorage } from "./service";

function createStubEmployeeService(branchSetupStatus: "completed" | "setup_pending") {
  const fileStorage = new InMemoryEmployeeFileStorage();

  return createEmployeeService({
    repository: {
      async findBranchSetupStatus() {
        return branchSetupStatus;
      },
      async createEmployee(input) {
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
      async updateEmployee(employeeId, input) {
        if (employeeId !== 1) {
          return null;
        }

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
}

describe("employee routes", () => {
  it("rejects invalid employee creation payloads with the project error shape", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app)
      .post("/employees")
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
      employeeService: createStubEmployeeService("setup_pending")
    });

    const response = await attachRequiredFiles(
      buildMultipartEmployeeRequest(request(app).post("/employees"), validPayload())
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
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await attachRequiredFiles(
      buildMultipartEmployeeRequest(request(app).post("/employees"), validPayload())
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
  });

  it("rejects employee creation when the required files are missing", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await buildMultipartEmployeeRequest(
      request(app).post("/employees"),
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
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).get("/employees").query({
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
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).get("/employees/1");

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
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).get("/employees/999");

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
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).patch("/employees/1").send({
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
  });

  it("returns validation errors for invalid employee updates", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).patch("/employees/1").send({
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
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).patch("/employees/1").send({
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
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).delete("/employees/1");

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
  });

  it("lists the current employee files", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).get("/employees/1/files");

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
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).get("/employees/1/files/1");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.body).toEqual(Buffer.from("file-bytes"));
  });

  it("replaces an employee file", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app)
      .put("/employees/1/files/personal_photo")
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
