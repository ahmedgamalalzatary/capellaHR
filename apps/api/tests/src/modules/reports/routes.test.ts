import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService } from "../../../../src/modules/auth/service";
import { createReportsService, type ReportsRepository } from "../../../../src/modules/reports/service";

class InMemoryReportsRepository implements ReportsRepository {
  async listEmployees() {
    return [
      {
        id: 1,
        fullName: "Mina Adel",
        branchId: 3,
        branchName: "Maadi"
      }
    ];
  }

  async listCompletedAttendanceDates() {
    return [
      { date: "2026-06-02", branchId: 2, branchName: "Nasr City" },
      { date: "2026-06-18", branchId: 3, branchName: "Maadi" }
    ];
  }

  async listWeeklyDayOffDates() {
    return ["2026-06-06", "2026-06-20"];
  }

  async listPermissionAbsenceDates() {
    return ["2026-06-10", "2026-06-25"];
  }

  async listBranchAssignments() {
    return [
      {
        branchId: 2,
        branchName: "Nasr City",
        effectiveFrom: "2026-06-01T00:00:00.000Z",
        effectiveTo: "2026-06-16T00:00:00.000Z"
      },
      {
        branchId: 3,
        branchName: "Maadi",
        effectiveFrom: "2026-06-16T00:00:00.000Z",
        effectiveTo: null
      }
    ];
  }
}

describe("reports routes", () => {
  it("returns unauthorized without an admin session", async () => {
    const app = createApp({
      reportsService: createReportsService({
        repository: new InMemoryReportsRepository()
      })
    });

    const response = await request(app).get("/reports/monthly-attendance-summary?month=2026-06");

    expect(response.status).toBe(401);
  });

  it("returns the monthly attendance summary for admins", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      reportsService: createReportsService({
        repository: new InMemoryReportsRepository()
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .get("/reports/monthly-attendance-summary")
      .set("Cookie", cookieHeader)
      .query({ month: "2026-06" });

    expect(response.status).toBe(200);
    expect(response.body.summaries).toEqual([
      {
        employeeId: 1,
        employeeName: "Mina Adel",
        branchId: 2,
        branchName: "Nasr City",
        month: "2026-06",
        attendanceDays: 1,
        weeklyDaysOff: 1,
        absenceWithPermission: 1,
        absenceWithoutPermission: 12
      },
      {
        employeeId: 1,
        employeeName: "Mina Adel",
        branchId: 3,
        branchName: "Maadi",
        month: "2026-06",
        attendanceDays: 1,
        weeklyDaysOff: 1,
        absenceWithPermission: 1,
        absenceWithoutPermission: 12
      }
    ]);
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
