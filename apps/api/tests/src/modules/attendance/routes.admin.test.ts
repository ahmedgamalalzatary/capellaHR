import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createAttendanceService } from "../../../../src/modules/attendance/service";
import {
  createBaseRepository,
  createEmployeeAuthService,
  signInAdmin,
  signInEmployee
} from "./attendance-routes.fixtures";

describe("attendance routes (admin)", () => {
  it("returns forbidden on admin attendance routes for employee sessions", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });
    const employeeCookie = await signInEmployee(app);

    const response = await request(app).get("/admin/attendance").set("Cookie", employeeCookie);

    expect(response.status).toBe(403);
  });

  it("lists admin attendance for admin sessions", async () => {
    const repository = createBaseRepository();
    repository.sessions.push({
      id: 1,
      employeeId: 2,
      branchId: 1,
      status: "completed",
      checkInAtUtc: new Date("2026-06-22T06:00:00.000Z"),
      checkOutAtUtc: new Date("2026-06-22T12:00:00.000Z"),
      checkInLatitude: 0,
      checkInLongitude: 0,
      checkInIpAddress: "",
      deviceId: "admin",
      branchPolicySnapshot: {},
      adminReason: "manual correction",
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({ repository })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app).get("/admin/attendance").set("Cookie", adminCookie).query({
      page: "1",
      pageSize: "10"
    });

    expect(response.status).toBe(200);
    expect(response.body.sessions).toEqual({
      items: [
        expect.objectContaining({
          employeeName: "Test Employee"
        })
      ],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1
      }
    });
  });

  it("creates admin attendance with a required reason", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .post("/admin/attendance")
      .set("Cookie", adminCookie)
      .send({
        employeeId: 2,
        branchId: 1,
        checkInAt: "2026-06-22T08:00:00.000Z",
        checkOutAt: "2026-06-22T16:00:00.000Z",
        reason: "manual correction"
      });

    expect(response.status).toBe(201);
    expect(response.body.session.status).toBe("completed");
  });

  it("updates admin attendance", async () => {
    const repository = createBaseRepository();
    repository.sessions.push({
      id: 1,
      employeeId: 2,
      branchId: 1,
      status: "completed",
      checkInAtUtc: new Date("2026-06-22T06:00:00.000Z"),
      checkOutAtUtc: new Date("2026-06-22T12:00:00.000Z"),
      checkInLatitude: 0,
      checkInLongitude: 0,
      checkInIpAddress: "",
      deviceId: "admin",
      branchPolicySnapshot: {},
      adminReason: "before",
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({ repository })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .patch("/admin/attendance/1")
      .set("Cookie", adminCookie)
      .send({
        branchId: 1,
        checkInAt: "2026-06-22T09:00:00.000Z",
        checkOutAt: "2026-06-22T17:00:00.000Z",
        reason: "manual correction"
      });

    expect(response.status).toBe(200);
    expect(response.body.session.adminReason).toBe("manual correction");
  });

  it("deletes admin attendance", async () => {
    const repository = createBaseRepository();
    repository.sessions.push({
      id: 1,
      employeeId: 2,
      branchId: 1,
      status: "completed",
      checkInAtUtc: new Date("2026-06-22T06:00:00.000Z"),
      checkOutAtUtc: new Date("2026-06-22T12:00:00.000Z"),
      checkInLatitude: 0,
      checkInLongitude: 0,
      checkInIpAddress: "",
      deviceId: "admin",
      branchPolicySnapshot: {},
      adminReason: "manual correction",
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({ repository })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .delete("/admin/attendance/1")
      .set("Cookie", adminCookie)
      .send({
        reason: "remove duplicate"
      });

    expect(response.status).toBe(204);
  });
});
