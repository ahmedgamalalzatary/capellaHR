import { describe, expect, it } from "vitest";
import { createEmployeeDeviceService } from "../../../../src/modules/employee-devices/service";
import {
  InMemoryEmployeeDeviceRepository,
  assertEmployeeDeviceState
} from "./employee-device-service.fixtures";

describe("employee device service (activation & revocation)", () => {
  it("activates a completed setup token and replaces the previous active device", async () => {
    const repository = new InMemoryEmployeeDeviceRepository();
    repository.registrations.push({
      id: 1,
      employeeId: 1,
      deviceToken: "existing-token",
      deviceLabel: "Existing phone",
      browserFingerprint: "existing-fingerprint",
      status: "active",
      registeredAt: new Date("2026-06-22T09:00:00.000Z"),
      revokedAt: null,
      expiresAt: null
    });
    repository.nextId = 2;

    const service = createEmployeeDeviceService({
      repository
    });
    const setup = await service.createSetupLink(1, {
      deviceLabel: "Replacement phone"
    }, 1);
    assertEmployeeDeviceState(setup);
    const result = await service.completeSetup(
      setup.pendingSetup!.deviceToken,
      {
        browserFingerprint: "replacement-fingerprint"
      }
    );

    expect(result).toEqual({
      employeeId: 1,
      activeDevice: {
        id: 2,
        deviceLabel: "Replacement phone",
        browserFingerprint: "replacement-fingerprint",
        registeredAt: expect.any(Date)
      },
      pendingSetup: null
    });
    expect(repository.registrations[0]).toMatchObject({
      status: "replaced"
    });
  });

  it("rejects expired setup tokens", async () => {
    const repository = new InMemoryEmployeeDeviceRepository();
    repository.registrations.push({
      id: 1,
      employeeId: 1,
      deviceToken: "expired-token",
      deviceLabel: "Expired phone",
      browserFingerprint: null,
      status: "pending",
      registeredAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 60_000)
    });

    const service = createEmployeeDeviceService({
      repository
    });

    const result = await service.completeSetup("expired-token", {
      browserFingerprint: "fingerprint"
    });

    expect(result).toEqual({
      error: {
        code: "EMPLOYEE_DEVICE_SETUP_EXPIRED",
        message: "Employee device setup link expired",
        details: {}
      }
    });
  });

  it("revokes active and pending device access", async () => {
    const repository = new InMemoryEmployeeDeviceRepository();
    repository.registrations.push(
      {
        id: 1,
        employeeId: 1,
        deviceToken: "active-token",
        deviceLabel: "Phone",
        browserFingerprint: "fingerprint",
        status: "active",
        registeredAt: new Date("2026-06-22T09:00:00.000Z"),
        revokedAt: null,
        expiresAt: null
      },
      {
        id: 2,
        employeeId: 1,
        deviceToken: "pending-token",
        deviceLabel: "Replacement",
        browserFingerprint: null,
        status: "pending",
        registeredAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000)
      }
    );

    const service = createEmployeeDeviceService({
      repository
    });
    const result = await service.revokeDeviceAccess(1, 1);

    expect(result).toEqual({
      success: true
    });
    expect(repository.registrations.map((registration) => registration.status)).toEqual(["revoked", "revoked"]);
  });
});
