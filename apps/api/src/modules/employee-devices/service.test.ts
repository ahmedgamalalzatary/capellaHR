import { describe, expect, it } from "vitest";
import { createEmployeeDeviceService, type EmployeeDeviceRepository } from "./service";
import type { EmployeeDeviceRegistrationRecord } from "./repository";

class InMemoryEmployeeDeviceRepository implements EmployeeDeviceRepository {
  employees = new Set([1]);
  registrations: EmployeeDeviceRegistrationRecord[] = [];
  nextId = 1;

  async findEmployeeById(employeeId: number) {
    return this.employees.has(employeeId) ? { id: employeeId } : null;
  }

  async findActiveRegistration(employeeId: number) {
    return this.registrations.find((registration) => registration.employeeId === employeeId && registration.status === "active") ?? null;
  }

  async findPendingRegistration(employeeId: number) {
    return this.registrations.find((registration) => registration.employeeId === employeeId && registration.status === "pending") ?? null;
  }

  async createPendingRegistration(input: {
    employeeId: number;
    deviceToken: string;
    deviceLabel?: string;
    expiresAt: Date;
  }) {
    const registration: EmployeeDeviceRegistrationRecord = {
      id: this.nextId++,
      employeeId: input.employeeId,
      deviceToken: input.deviceToken,
      deviceLabel: input.deviceLabel ?? null,
      browserFingerprint: null,
      status: "pending",
      registeredAt: null,
      revokedAt: null,
      expiresAt: input.expiresAt
    };

    this.registrations.push(registration);
    return registration;
  }

  async findPendingRegistrationByToken(deviceToken: string) {
    return this.registrations.find((registration) => registration.deviceToken === deviceToken && registration.status === "pending") ?? null;
  }

  async revokePendingRegistrations(employeeId: number, revokedAt: Date) {
    for (const registration of this.registrations) {
      if (registration.employeeId === employeeId && registration.status === "pending") {
        registration.status = "revoked";
        registration.revokedAt = revokedAt;
      }
    }
  }

  async activatePendingRegistration(registrationId: number, input: {
    deviceLabel?: string;
    browserFingerprint: string;
    registeredAt: Date;
  }) {
    const registration = this.registrations.find((item) => item.id === registrationId) ?? null;

    if (!registration || registration.status !== "pending") {
      return null;
    }

    registration.status = "active";
    registration.deviceLabel = input.deviceLabel ?? registration.deviceLabel;
    registration.browserFingerprint = input.browserFingerprint;
    registration.registeredAt = input.registeredAt;
    registration.expiresAt = null;
    return registration;
  }

  async replaceActiveRegistrations(employeeId: number, keepRegistrationId: number, replacedAt: Date) {
    for (const registration of this.registrations) {
      if (registration.employeeId === employeeId && registration.status === "active" && registration.id !== keepRegistrationId) {
        registration.status = "replaced";
        registration.revokedAt = replacedAt;
      }
    }
  }

  async revokeDeviceAccess(employeeId: number, revokedAt: Date) {
    let changed = false;

    for (const registration of this.registrations) {
      if (registration.employeeId === employeeId && (registration.status === "pending" || registration.status === "active")) {
        registration.status = "revoked";
        registration.revokedAt = revokedAt;
        changed = true;
      }
    }

    return changed;
  }
}

describe("employee device service", () => {
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

function assertEmployeeDeviceState(
  value: Awaited<ReturnType<ReturnType<typeof createEmployeeDeviceService>["createSetupLink"]>>
): asserts value is {
  employeeId: number;
  activeDevice: {
    id: number;
    deviceLabel: string | null;
    browserFingerprint: string;
    registeredAt: Date;
  } | null;
  pendingSetup: {
    id: number;
    deviceToken: string;
    deviceLabel: string | null;
    expiresAt: Date;
  } | null;
} {
  expect("error" in value).toBe(false);
}
