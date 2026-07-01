import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  WeeklyDayOffAssignmentCreateInput,
  WeeklyDayOffAssignmentUpdateInput
} from "@capella/shared";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService } from "../../../../src/modules/auth/service";
import { createWeeklyDayOffService } from "../../../../src/modules/weekly-day-offs/service";
import type {
  WeeklyDayOffAssignmentRecord,
  WeeklyDayOffRepository
} from "../../../../src/modules/weekly-day-offs/service";

class InMemoryWeeklyDayOffRepository implements WeeklyDayOffRepository {
  employees = new Set([1]);
  assignments: WeeklyDayOffAssignmentRecord[] = [];
  nextId = 1;

  async findEmployeeById(employeeId: number) {
    return this.employees.has(employeeId) ? { id: employeeId } : null;
  }

  async listAssignments(employeeId: number, weekStartDate?: string) {
    return this.assignments.filter((assignment) =>
      assignment.employeeId === employeeId
      && (!weekStartDate || assignment.weekStartDate === weekStartDate)
    );
  }

  async findAssignmentById(assignmentId: number) {
    return this.assignments.find((assignment) => assignment.id === assignmentId) ?? null;
  }

  async hasAttendanceOnDate() {
    return false;
  }

  async isMonthLocked() {
    return false;
  }

  async createAssignment(input: {
    employeeId: number;
    weekStartDate: string;
    dayOffDate: string;
    overrideReason?: string;
    assignedByAdminId: number;
  }) {
    const assignment: WeeklyDayOffAssignmentRecord = {
      id: this.nextId++,
      employeeId: input.employeeId,
      weekStartDate: input.weekStartDate,
      dayOffDate: input.dayOffDate,
      overrideReason: input.overrideReason ?? null,
      assignedByAdminId: input.assignedByAdminId
    };

    this.assignments.push(assignment);
    return assignment;
  }

  async updateAssignment(assignmentId: number, input: {
    weekStartDate: string;
    dayOffDate: string;
    overrideReason?: string | null;
  }) {
    const assignment = this.assignments.find((item) => item.id === assignmentId) ?? null;

    if (!assignment) {
      return null;
    }

    assignment.weekStartDate = input.weekStartDate;
    assignment.dayOffDate = input.dayOffDate;
    assignment.overrideReason = input.overrideReason ?? null;

    return assignment;
  }
}

describe("weekly day off routes", () => {
  it("returns unauthorized without an admin session", async () => {
    const app = createApp({
      weeklyDayOffService: createWeeklyDayOffService({
        repository: new InMemoryWeeklyDayOffRepository()
      })
    });

    const response = await request(app).get("/employees/1/weekly-day-offs");

    expect(response.status).toBe(401);
  });

  it("creates a weekly day off assignment for admins", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      weeklyDayOffService: createWeeklyDayOffService({
        repository: new InMemoryWeeklyDayOffRepository()
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .post("/employees/1/weekly-day-offs")
      .set("Cookie", cookieHeader)
      .send(validCreatePayload("2026-06-29"));

    expect(response.status).toBe(201);
    expect(response.body.assignment.weekStartDate).toBe("2026-06-27");
  });

  it("lists weekly day off assignments for an employee", async () => {
    const repository = new InMemoryWeeklyDayOffRepository();
    repository.assignments.push({
      id: 1,
      employeeId: 1,
      weekStartDate: "2026-06-27",
      dayOffDate: "2026-06-29",
      overrideReason: null,
      assignedByAdminId: 1
    });
    const app = createApp({
      authService: createAdminAuthService(),
      weeklyDayOffService: createWeeklyDayOffService({
        repository
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .get("/employees/1/weekly-day-offs")
      .set("Cookie", cookieHeader)
      .query({ weekStartDate: "2026-06-27" });

    expect(response.status).toBe(200);
    expect(response.body.assignments).toHaveLength(1);
  });

  it("updates an existing weekly day off assignment", async () => {
    const repository = new InMemoryWeeklyDayOffRepository();
    repository.assignments.push({
      id: 1,
      employeeId: 1,
      weekStartDate: "2026-06-27",
      dayOffDate: "2026-06-29",
      overrideReason: null,
      assignedByAdminId: 1
    });
    const app = createApp({
      authService: createAdminAuthService(),
      weeklyDayOffService: createWeeklyDayOffService({
        repository
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .patch("/weekly-day-offs/1")
      .set("Cookie", cookieHeader)
      .send(validUpdatePayload("2026-06-30"));

    expect(response.status).toBe(200);
    expect(response.body.assignment.dayOffDate).toBe("2026-06-30");
  });

  it("clears an existing weekly day off override reason", async () => {
    const repository = new InMemoryWeeklyDayOffRepository();
    repository.assignments.push({
      id: 1,
      employeeId: 1,
      weekStartDate: "2026-06-27",
      dayOffDate: "2026-06-29",
      overrideReason: "Schedule override",
      assignedByAdminId: 1
    });
    const app = createApp({
      authService: createAdminAuthService(),
      weeklyDayOffService: createWeeklyDayOffService({
        repository
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .patch("/weekly-day-offs/1")
      .set("Cookie", cookieHeader)
      .send({ dayOffDate: "2026-06-29", overrideReason: null });

    expect(response.status).toBe(200);
    expect(response.body.assignment.overrideReason).toBeNull();
  });
});

function createAdminAuthService() {
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

async function signInAdmin(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: "admin.test@capella.invalid",
    password: "test-admin-pass-123"
  });

  return response.headers["set-cookie"];
}

function validCreatePayload(dayOffDate: string): WeeklyDayOffAssignmentCreateInput {
  return { dayOffDate };
}

function validUpdatePayload(dayOffDate: string): WeeklyDayOffAssignmentUpdateInput {
  return { dayOffDate };
}
