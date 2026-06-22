import { describe, expect, it } from "vitest";
import { createEmployeeDeviceService } from "../../../../src/modules/employee-devices/service";
import {
  InMemoryEmployeeDeviceRepository,
  assertEmployeeDeviceState
} from "./employee-device-service.fixtures";

describe("employee device service (setup link)", () => {
  it("creates a one-hour setup link", async () => {
    const service = createEmployeeDeviceService({
      repository: new InMemoryEmployeeDeviceRepository()
    });

    const result = await service.createSetupLink(1, {
      deviceLabel: "Samsung A55"
    }, 1);
    assertEmployeeDeviceState(result);

    expect(result).toMatchObject({
      employeeId: 1,
      pendingSetup: {
        deviceLabel: "Samsung A55",
        deviceToken: expect.any(String)
      },
      activeDevice: null
    });
    expect(result.pendingSetup?.expiresAt).toBeInstanceOf(Date);
  });

  it("replaces an older pending setup link when generating a new one", async () => {
    const repository = new InMemoryEmployeeDeviceRepository();
    const service = createEmployeeDeviceService({
      repository
    });

    const first = await service.createSetupLink(1, {
      deviceLabel: "Old phone"
    }, 1);
    const second = await service.createSetupLink(1, {
      deviceLabel: "New phone"
    }, 1);
    assertEmployeeDeviceState(first);
    assertEmployeeDeviceState(second);

    expect(second.pendingSetup?.deviceToken).not.toBe(first.pendingSetup?.deviceToken);
    expect(repository.registrations).toEqual([
      expect.objectContaining({
        deviceLabel: "Old phone",
        status: "revoked"
      }),
      expect.objectContaining({
        deviceLabel: "New phone",
        status: "pending"
      })
    ]);
  });
});
