import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createEmployeeDeviceService } from "../../../../src/modules/employee-devices/service";
import {
  InMemoryEmployeeDeviceRepository,
  createAdminAuthService,
  signInAdmin,
  validCreatePayload
} from "./employee-device-routes.fixtures";

describe("employee device routes (read & create)", () => {
  it("returns unauthorized without an admin session", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeDeviceService: createEmployeeDeviceService({
        repository: new InMemoryEmployeeDeviceRepository()
      })
    });

    const response = await request(app).get("/employees/1/device");

    expect(response.status).toBe(401);
  });

  it("creates a setup link for authenticated admins", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeDeviceService: createEmployeeDeviceService({
        repository: new InMemoryEmployeeDeviceRepository()
      })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .post("/employees/1/device/setup-links")
      .set("Cookie", adminCookie)
      .send(validCreatePayload());

    expect(response.status).toBe(201);
    expect(response.body.employeeDevice.pendingSetup.deviceLabel).toBe("Samsung A55");
  });

  it("returns the current device state for admins", async () => {
    const repository = new InMemoryEmployeeDeviceRepository();
    repository.registrations.push({
      id: 1,
      employeeId: 1,
      deviceToken: "active-token",
      deviceLabel: "Phone",
      browserFingerprint: "fingerprint",
      status: "active",
      registeredAt: new Date("2026-06-22T08:00:00.000Z"),
      revokedAt: null,
      expiresAt: null
    });

    const app = createApp({
      authService: createAdminAuthService(),
      employeeDeviceService: createEmployeeDeviceService({
        repository
      })
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app).get("/employees/1/device").set("Cookie", adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.employeeDevice.activeDevice.deviceLabel).toBe("Phone");
  });
});
