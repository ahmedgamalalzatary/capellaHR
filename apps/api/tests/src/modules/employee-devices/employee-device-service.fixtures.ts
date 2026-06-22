import { expect } from "vitest";
import { createEmployeeDeviceService, type EmployeeDeviceRepository } from "../../../../src/modules/employee-devices/service";
import type { EmployeeDeviceRegistrationRecord } from "../../../../src/modules/employee-devices/repository";

export class InMemoryEmployeeDeviceRepository implements EmployeeDeviceRepository {
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

export function assertEmployeeDeviceState(
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
