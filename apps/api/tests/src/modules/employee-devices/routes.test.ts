import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  EmployeeDeviceSetupCompletionInput,
  EmployeeDeviceSetupLinkCreateInput
} from "@capella/shared";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService } from "../../../../src/modules/auth/service";
import { createEmployeeDeviceService } from "../../../../src/modules/employee-devices/service";
import type { EmployeeDeviceRegistrationRecord } from "../../../../src/modules/employee-devices/repository";
import type { EmployeeDeviceRepository } from "../../../../src/modules/employee-devices/service";

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
    registration.browserFingerprint = input.browserFingerprint;
    registration.deviceLabel = input.deviceLabel ?? registration.deviceLabel;
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

describe("employee device routes", () => {
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

function validCreatePayload(): EmployeeDeviceSetupLinkCreateInput {
  return {
    deviceLabel: "Samsung A55"
  };
}

function validCompletionPayload(): EmployeeDeviceSetupCompletionInput {
  return {
    browserFingerprint: "browser-fingerprint"
  };
}

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
