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
        branchId: 2,
        branchName: "Nasr City"
      }
    ];
  }

  async listCompletedAttendanceDates() {
    return ["2026-06-01", "2026-06-15"];
  }

  async listWeeklyDayOffDates() {
    return ["2026-06-06", "2026-06-13", "2026-06-20", "2026-06-27"];
  }

  async listPermissionAbsenceDates() {
    return ["2026-06-10"];
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
        attendanceDays: 2,
        weeklyDaysOff: 4,
        absenceWithPermission: 1,
        absenceWithoutPermission: 23
      }
    ]);
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
