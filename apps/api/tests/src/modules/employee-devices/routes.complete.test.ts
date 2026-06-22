import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createEmployeeDeviceService } from "../../../../src/modules/employee-devices/service";
import {
  InMemoryEmployeeDeviceRepository,
  assertEmployeeDeviceState,
  createAdminAuthService,
  signInAdmin,
  validCompletionPayload
} from "./employee-device-routes.fixtures";

describe("employee device routes (complete & revoke)", () => {
  it("completes device setup from the setup token endpoint", async () => {
    const repository = new InMemoryEmployeeDeviceRepository();
    const service = createEmployeeDeviceService({
      repository
    });
    const setup = await service.createSetupLink(1, {
      deviceLabel: "Samsung A55"
    }, 1);
    assertEmployeeDeviceState(setup);
    const app = createApp({
      authService: createAdminAuthService(),
      employeeDeviceService: service
    });

    const response = await request(app)
      .post(`/employee-device-setup/${setup.pendingSetup!.deviceToken}/complete`)
      .send(validCompletionPayload());

    expect(response.status).toBe(200);
    expect(response.body.employeeDevice.activeDevice.browserFingerprint).toBe("browser-fingerprint");
  });

  it("revokes employee device access for admins", async () => {
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

    const response = await request(app).delete("/employees/1/device").set("Cookie", adminCookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true
    });
  });
});
