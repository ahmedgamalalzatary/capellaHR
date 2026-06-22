import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  PermissionAbsenceCreateInput,
  PermissionAbsenceUpdateInput
} from "@capella/shared";
import { createApp } from "../../app";
import { createInMemoryAuthRepository } from "../auth/repository";
import { createAuthService } from "../auth/service";
import { createPermissionAbsenceService } from "./service";
import type {
  PermissionAbsenceRecord,
  PermissionAbsenceRepository
} from "./service";

class InMemoryPermissionAbsenceRepository implements PermissionAbsenceRepository {
  employees = new Set([1]);
  absences: PermissionAbsenceRecord[] = [];
  nextId = 1;

  async findEmployeeById(employeeId: number) {
    return this.employees.has(employeeId) ? { id: employeeId } : null;
  }

  async listAbsences(employeeId: number, monthKey?: string) {
    return this.absences.filter((absence) =>
      absence.employeeId === employeeId
      && (!monthKey || absence.absenceDate.startsWith(monthKey))
    );
  }

  async findAbsenceById(absenceId: number) {
    return this.absences.find((absence) => absence.id === absenceId) ?? null;
  }

  async hasAttendanceOnDate() {
    return false;
  }

  async isMonthLocked() {
    return false;
  }

  async createAbsence(input: {
    employeeId: number;
    absenceDate: string;
    createdByAdminId: number;
  }) {
    const absence: PermissionAbsenceRecord = {
      id: this.nextId++,
      employeeId: input.employeeId,
      absenceDate: input.absenceDate,
      permissionType: "generic",
      reason: null,
      createdByAdminId: input.createdByAdminId,
      updatedByAdminId: null
    };

    this.absences.push(absence);
    return absence;
  }

  async updateAbsence(absenceId: number, input: { absenceDate: string; updatedByAdminId: number }) {
    const absence = this.absences.find((item) => item.id === absenceId) ?? null;

    if (!absence) {
      return null;
    }

    absence.absenceDate = input.absenceDate;
    absence.updatedByAdminId = input.updatedByAdminId;

    return absence;
  }
}

describe("permission absence routes", () => {
  it("returns unauthorized without an admin session", async () => {
    const app = createApp({
      permissionAbsenceService: createPermissionAbsenceService({
        repository: new InMemoryPermissionAbsenceRepository()
      })
    });

    const response = await request(app).get("/employees/1/permission-absences");

    expect(response.status).toBe(401);
  });

  it("creates a permission absence for admins", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      permissionAbsenceService: createPermissionAbsenceService({
        repository: new InMemoryPermissionAbsenceRepository()
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .post("/employees/1/permission-absences")
      .set("Cookie", cookieHeader)
      .send(validCreatePayload("2026-06-29"));

    expect(response.status).toBe(201);
    expect(response.body.absence.permissionType).toBe("generic");
  });

  it("lists permission absences for an employee", async () => {
    const repository = new InMemoryPermissionAbsenceRepository();
    repository.absences.push({
      id: 1,
      employeeId: 1,
      absenceDate: "2026-06-29",
      permissionType: "generic",
      reason: null,
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const app = createApp({
      authService: createAdminAuthService(),
      permissionAbsenceService: createPermissionAbsenceService({
        repository
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .get("/employees/1/permission-absences")
      .set("Cookie", cookieHeader)
      .query({ monthKey: "2026-06" });

    expect(response.status).toBe(200);
    expect(response.body.absences).toHaveLength(1);
  });

  it("updates an existing permission absence", async () => {
    const repository = new InMemoryPermissionAbsenceRepository();
    repository.absences.push({
      id: 1,
      employeeId: 1,
      absenceDate: "2026-06-29",
      permissionType: "generic",
      reason: null,
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const app = createApp({
      authService: createAdminAuthService(),
      permissionAbsenceService: createPermissionAbsenceService({
        repository
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .patch("/permission-absences/1")
      .set("Cookie", cookieHeader)
      .send(validUpdatePayload("2026-06-30"));

    expect(response.status).toBe(200);
    expect(response.body.absence.absenceDate).toBe("2026-06-30");
  });
});

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

async function signInAdmin(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: "admin@capella.eg",
    password: "admin1234"
  });

  return response.headers["set-cookie"];
}

function validCreatePayload(absenceDate: string): PermissionAbsenceCreateInput {
  return { absenceDate };
}

function validUpdatePayload(absenceDate: string): PermissionAbsenceUpdateInput {
  return { absenceDate };
}
