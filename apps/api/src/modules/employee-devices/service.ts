import { randomBytes } from "node:crypto";
import type {
  EmployeeDeviceSetupCompletionInput,
  EmployeeDeviceSetupLinkCreateInput
} from "@capella/shared";
import type { createAuditLogService } from "../audit-logs/service";
import type { EmployeeDeviceRegistrationRecord } from "./repository";

type EmployeeDeviceState = {
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
};

type EmployeeDeviceErrorResult = {
  error: {
    code:
      | "EMPLOYEE_NOT_FOUND"
      | "EMPLOYEE_DEVICE_SETUP_NOT_FOUND"
      | "EMPLOYEE_DEVICE_SETUP_EXPIRED";
    message: string;
    details: Record<string, unknown>;
  };
};

export type EmployeeDeviceRepository = {
  findEmployeeById(employeeId: number): Promise<{ id: number } | null>;
  findActiveRegistration(employeeId: number): Promise<EmployeeDeviceRegistrationRecord | null>;
  findPendingRegistration(employeeId: number): Promise<EmployeeDeviceRegistrationRecord | null>;
  createPendingRegistration(input: {
    employeeId: number;
    deviceToken: string;
    deviceLabel?: string;
    expiresAt: Date;
  }): Promise<EmployeeDeviceRegistrationRecord>;
  findPendingRegistrationByToken(deviceToken: string): Promise<EmployeeDeviceRegistrationRecord | null>;
  revokePendingRegistrations(employeeId: number, revokedAt: Date): Promise<void>;
  activatePendingRegistration(registrationId: number, input: {
    deviceLabel?: string;
    browserFingerprint: string;
    registeredAt: Date;
  }): Promise<EmployeeDeviceRegistrationRecord | null>;
  replaceActiveRegistrations(employeeId: number, keepRegistrationId: number, replacedAt: Date): Promise<void>;
  revokeDeviceAccess(employeeId: number, revokedAt: Date): Promise<boolean>;
};

type CreateEmployeeDeviceServiceOptions = {
  repository: EmployeeDeviceRepository;
  auditLogService?: ReturnType<typeof createAuditLogService>;
};

export function createEmployeeDeviceService(options: CreateEmployeeDeviceServiceOptions) {
  return {
    async getEmployeeDevice(employeeId: number) {
      const employee = await options.repository.findEmployeeById(employeeId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      return buildEmployeeDeviceState(
        employee.id,
        await options.repository.findActiveRegistration(employee.id),
        await options.repository.findPendingRegistration(employee.id)
      );
    },

    async createSetupLink(
      employeeId: number,
      input: EmployeeDeviceSetupLinkCreateInput,
      createdByAdminId: number
    ) {
      const employee = await options.repository.findEmployeeById(employeeId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      const beforeState = buildEmployeeDeviceState(
        employee.id,
        await options.repository.findActiveRegistration(employee.id),
        await options.repository.findPendingRegistration(employee.id)
      );

      await options.repository.revokePendingRegistrations(employee.id, new Date());

      const pending = await options.repository.createPendingRegistration({
        employeeId: employee.id,
        deviceToken: createDeviceToken(),
        deviceLabel: input.deviceLabel,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });

      const state = buildEmployeeDeviceState(
        employee.id,
        await options.repository.findActiveRegistration(employee.id),
        pending
      );

      await options.auditLogService?.recordAuditLog({
        adminId: createdByAdminId,
        actionType: "setup_link_create",
        entityType: "employee_device",
        entityId: String(employee.id),
        before: employeeDeviceStateToAuditPayload(beforeState),
        after: employeeDeviceStateToAuditPayload(state)
      });

      return state;
    },

    async completeSetup(
      deviceToken: string,
      input: EmployeeDeviceSetupCompletionInput
    ) {
      const pending = await options.repository.findPendingRegistrationByToken(deviceToken);

      if (!pending) {
        return createSetupNotFoundError();
      }

      if (!pending.expiresAt || pending.expiresAt.getTime() <= Date.now()) {
        await options.repository.revokePendingRegistrations(pending.employeeId, new Date());
        return createSetupExpiredError();
      }

      const active = await options.repository.activatePendingRegistration(pending.id, {
        deviceLabel: input.deviceLabel,
        browserFingerprint: input.browserFingerprint,
        registeredAt: new Date()
      });

      if (!active) {
        return createSetupNotFoundError();
      }

      await options.repository.replaceActiveRegistrations(
        pending.employeeId,
        active.id,
        new Date()
      );

      return buildEmployeeDeviceState(pending.employeeId, active, null);
    },

    async revokeDeviceAccess(employeeId: number, revokedByAdminId: number) {
      const employee = await options.repository.findEmployeeById(employeeId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      const beforeState = buildEmployeeDeviceState(
        employee.id,
        await options.repository.findActiveRegistration(employee.id),
        await options.repository.findPendingRegistration(employee.id)
      );

      const revoked = await options.repository.revokeDeviceAccess(employeeId, new Date());

      const afterState = buildEmployeeDeviceState(
        employee.id,
        await options.repository.findActiveRegistration(employee.id),
        await options.repository.findPendingRegistration(employee.id)
      );

      await options.auditLogService?.recordAuditLog({
        adminId: revokedByAdminId,
        actionType: "revoke",
        entityType: "employee_device",
        entityId: String(employee.id),
        before: employeeDeviceStateToAuditPayload(beforeState),
        after: employeeDeviceStateToAuditPayload(afterState)
      });

      return {
        success: revoked
      } as const;
    }
  };
}

function employeeDeviceStateToAuditPayload(state: EmployeeDeviceState) {
  return {
    employeeId: state.employeeId,
    activeDevice: state.activeDevice ? {
      id: state.activeDevice.id,
      deviceLabel: state.activeDevice.deviceLabel,
      browserFingerprint: state.activeDevice.browserFingerprint
    } : null,
    pendingSetup: state.pendingSetup ? {
      id: state.pendingSetup.id,
      deviceLabel: state.pendingSetup.deviceLabel,
      expiresAt: state.pendingSetup.expiresAt.toISOString()
    } : null
  };
}

function buildEmployeeDeviceState(
  employeeId: number,
  active: EmployeeDeviceRegistrationRecord | null,
  pending: EmployeeDeviceRegistrationRecord | null
): EmployeeDeviceState {
  return {
    employeeId,
    activeDevice: active && active.browserFingerprint && active.registeredAt ? {
      id: active.id,
      deviceLabel: active.deviceLabel,
      browserFingerprint: active.browserFingerprint,
      registeredAt: active.registeredAt
    } : null,
    pendingSetup: pending && pending.expiresAt ? {
      id: pending.id,
      deviceToken: pending.deviceToken,
      deviceLabel: pending.deviceLabel,
      expiresAt: pending.expiresAt
    } : null
  };
}

function createDeviceToken() {
  return randomBytes(32).toString("base64url");
}

function createEmployeeNotFoundError(): EmployeeDeviceErrorResult {
  return {
    error: {
      code: "EMPLOYEE_NOT_FOUND",
      message: "Employee not found",
      details: {}
    }
  };
}

function createSetupNotFoundError(): EmployeeDeviceErrorResult {
  return {
    error: {
      code: "EMPLOYEE_DEVICE_SETUP_NOT_FOUND",
      message: "Employee device setup link not found",
      details: {}
    }
  };
}

function createSetupExpiredError(): EmployeeDeviceErrorResult {
  return {
    error: {
      code: "EMPLOYEE_DEVICE_SETUP_EXPIRED",
      message: "Employee device setup link expired",
      details: {}
    }
  };
}
