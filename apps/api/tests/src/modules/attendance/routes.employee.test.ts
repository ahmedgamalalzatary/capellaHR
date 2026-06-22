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

describe("attendance routes (employee)", () => {
  it("returns unauthorized on employee attendance routes without a session", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });

    const response = await request(app).get("/attendance/me");

    expect(response.status).toBe(401);
  });

  it("returns forbidden on employee attendance routes for admin sessions", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app).get("/attendance/me").set("Cookie", adminCookie);

    expect(response.status).toBe(403);
  });

  it("returns the current employee attendance state", async () => {
    const repository = createBaseRepository();
    repository.sessions.push({
      id: 1,
      employeeId: 2,
      branchId: 1,
      status: "open",
      checkInAtUtc: new Date("2026-06-22T06:00:00.000Z"),
      checkOutAtUtc: null,
      checkInLatitude: 30.04442,
      checkInLongitude: 31.235712,
      checkInIpAddress: "192.168.1.42",
      deviceId: "personal-device-1",
      branchPolicySnapshot: {
        allowedIpCidr: "192.168.1.0/24"
      }
    });

    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({ repository })
    });
    const employeeCookie = await signInEmployee(app);

    const response = await request(app).get("/attendance/me").set("Cookie", employeeCookie);

    expect(response.status).toBe(200);
    expect(response.body.attendance.currentAction).toBe("check_out");
    expect(response.body.attendance.todaySessions).toHaveLength(1);
  });

  it("returns the employee attendance history with pagination", async () => {
    const repository = createBaseRepository();
    repository.sessions.push(
      {
        id: 1,
        employeeId: 2,
        branchId: 1,
        status: "completed",
        checkInAtUtc: new Date("2026-06-21T06:00:00.000Z"),
        checkOutAtUtc: new Date("2026-06-21T14:00:00.000Z"),
        checkInLatitude: 30.04442,
        checkInLongitude: 31.235712,
        checkInIpAddress: "192.168.1.42",
        deviceId: "personal-device-1",
        branchPolicySnapshot: {
          allowedIpCidr: "192.168.1.0/24"
        }
      },
      {
        id: 2,
        employeeId: 2,
        branchId: 1,
        status: "open",
        checkInAtUtc: new Date("2026-06-22T06:00:00.000Z"),
        checkOutAtUtc: null,
        checkInLatitude: 30.04442,
        checkInLongitude: 31.235712,
        checkInIpAddress: "192.168.1.42",
        deviceId: "personal-device-1",
        branchPolicySnapshot: {
          allowedIpCidr: "192.168.1.0/24"
        }
      }
    );

    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({ repository })
    });
    const employeeCookie = await signInEmployee(app);

    const response = await request(app)
      .get("/attendance/history")
      .set("Cookie", employeeCookie)
      .query({
        page: "1",
        pageSize: "1"
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      sessions: {
        items: [
          {
            id: 2,
            employeeId: 2,
            branchId: 1,
            status: "open",
            checkInAtUtc: "2026-06-22T06:00:00.000Z",
            checkOutAtUtc: null,
            checkInLatitude: 30.04442,
            checkInLongitude: 31.235712,
            checkInIpAddress: "192.168.1.42",
            deviceId: "personal-device-1",
            branchPolicySnapshot: {
              allowedIpCidr: "192.168.1.0/24"
            }
          }
        ],
        pagination: {
          page: 1,
          pageSize: 1,
          total: 2,
          totalPages: 2
        }
      }
    });
  });

  it("records an employee check-in", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });
    const employeeCookie = await signInEmployee(app);

    const response = await request(app)
      .post("/attendance/action")
      .set("Cookie", employeeCookie)
      .set("X-Forwarded-For", "192.168.1.42")
      .send({
        action: "check_in",
        latitude: 30.04442,
        longitude: 31.235712,
        deviceId: "personal-device-1"
      });

    expect(response.status).toBe(200);
    expect(response.body.attendance.currentAction).toBe("check_out");
  });

  it("returns blocked validation attempts without losing the attendance state payload", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      attendanceService: createAttendanceService({
        repository: createBaseRepository()
      })
    });
    const employeeCookie = await signInEmployee(app);

    const response = await request(app)
      .post("/attendance/action")
      .set("Cookie", employeeCookie)
      .set("X-Forwarded-For", "10.0.0.10")
      .send({
        action: "check_in",
        latitude: 29,
        longitude: 31,
        deviceId: "unknown-device"
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toEqual({
      code: "ATTENDANCE_VALIDATION_FAILED",
      message: "Attendance validation failed",
      details: {
        failureReasons: ["device_not_allowed", "gps_out_of_range", "ip_not_allowed"]
      }
    });
    expect(response.body.attendance.currentAction).toBe("check_in");
  });
});
