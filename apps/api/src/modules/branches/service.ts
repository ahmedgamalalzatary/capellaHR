import { randomBytes } from "node:crypto";
import type {
  BranchCreateInput,
  BranchSearchInput,
  BranchSetupCompletionInput,
  BranchSetupLinkCreateInput,
  BranchUpdateInput
} from "@capella/shared";
import type { createAuditLogService } from "../audit-logs/service";
import type { BranchDeviceRegistrationRecord, BranchRecord, BranchSetupLinkRecord } from "./repository";

type BranchErrorResult = {
  error: {
    code: "BRANCH_NOT_FOUND" | "BRANCH_SETUP_NOT_FOUND" | "BRANCH_SETUP_EXPIRED";
    message: string;
    details: Record<string, unknown>;
  };
};

export type BranchRepository = {
  createBranch(input: BranchCreateInput): Promise<BranchRecord>;
  listBranches(filters: BranchSearchInput): Promise<BranchRecord[]>;
  findBranchById(branchId: number): Promise<BranchRecord | null>;
  updateBranch(branchId: number, input: BranchUpdateInput): Promise<BranchRecord | null>;
  findActiveRegistration(branchId: number): Promise<BranchDeviceRegistrationRecord | null>;
  findPendingSetupLink(branchId: number): Promise<BranchSetupLinkRecord | null>;
  createSetupLink(input: {
    branchId: number;
    token: string;
    deviceLabel?: string;
    expiresAt: Date;
    createdByAdminId: number;
  }): Promise<BranchSetupLinkRecord>;
  findPendingSetupLinkByToken(token: string): Promise<BranchSetupLinkRecord | null>;
  revokePendingSetupLinks(branchId: number, revokedAt: Date): Promise<void>;
  activateSetupLink(token: string, input: {
    deviceLabel?: string;
    browserFingerprint: string;
    registeredAt: Date;
  }): Promise<BranchDeviceRegistrationRecord | null>;
  replaceActiveRegistrations(branchId: number, keepRegistrationId: number, replacedAt: Date): Promise<void>;
};

type CreateBranchServiceOptions = {
  repository: BranchRepository;
  auditLogService?: ReturnType<typeof createAuditLogService>;
};

export function createBranchService(options: CreateBranchServiceOptions) {
  return {
    async createBranch(input: BranchCreateInput, createdByAdminId: number) {
      const branch = await options.repository.createBranch(input);

      await options.auditLogService?.recordAuditLog({
        adminId: createdByAdminId,
        actionType: "create",
        entityType: "branch",
        entityId: String(branch.id),
        entityDisplayName: branch.name,
        before: null,
        after: branch as unknown as Record<string, unknown>
      });

      return branch;
    },

    async listBranches(filters: BranchSearchInput) {
      return options.repository.listBranches(filters);
    },

    async getBranchById(branchId: number) {
      const branch = await options.repository.findBranchById(branchId);

      if (!branch) {
        return createBranchNotFoundError();
      }

      return branch;
    },

    async updateBranch(branchId: number, input: BranchUpdateInput, updatedByAdminId: number) {
      const existing = await options.repository.findBranchById(branchId);

      if (!existing) {
        return createBranchNotFoundError();
      }

      const branch = await options.repository.updateBranch(branchId, input);

      if (!branch) {
        return createBranchNotFoundError();
      }

      await options.auditLogService?.recordAuditLog({
        adminId: updatedByAdminId,
        actionType: "update",
        entityType: "branch",
        entityId: String(branch.id),
        entityDisplayName: branch.name,
        before: existing as unknown as Record<string, unknown>,
        after: branch as unknown as Record<string, unknown>
      });

      return branch;
    },

    async getBranchDevice(branchId: number) {
      const branch = await options.repository.findBranchById(branchId);

      if (!branch) {
        return createBranchNotFoundError();
      }

      return buildBranchDeviceState(
        branch,
        await options.repository.findActiveRegistration(branch.id),
        await options.repository.findPendingSetupLink(branch.id)
      );
    },

    async createSetupLink(branchId: number, input: BranchSetupLinkCreateInput, createdByAdminId: number) {
      const branch = await options.repository.findBranchById(branchId);

      if (!branch) {
        return createBranchNotFoundError();
      }

      const beforeState = buildBranchDeviceState(
        branch,
        await options.repository.findActiveRegistration(branch.id),
        await options.repository.findPendingSetupLink(branch.id)
      );

      await options.repository.revokePendingSetupLinks(branch.id, new Date());

      const pendingSetup = await options.repository.createSetupLink({
        branchId: branch.id,
        token: createSetupToken(),
        deviceLabel: input.deviceLabel,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdByAdminId
      });

      const state = buildBranchDeviceState(
        branch,
        await options.repository.findActiveRegistration(branch.id),
        pendingSetup
      );

      await options.auditLogService?.recordAuditLog({
        adminId: createdByAdminId,
        actionType: "setup_link_create",
        entityType: "branch_device",
        entityId: String(branch.id),
        entityDisplayName: branch.name,
        before: branchDeviceStateToAuditPayload(beforeState),
        after: branchDeviceStateToAuditPayload(state)
      });

      return state;
    },

    async completeSetup(token: string, input: BranchSetupCompletionInput) {
      const pendingSetup = await options.repository.findPendingSetupLinkByToken(token);

      if (!pendingSetup) {
        return createBranchSetupNotFoundError();
      }

      if (pendingSetup.expiresAt.getTime() <= Date.now()) {
        await options.repository.revokePendingSetupLinks(pendingSetup.branchId, new Date());
        return createBranchSetupExpiredError();
      }

      const device = await options.repository.activateSetupLink(token, {
        deviceLabel: input.deviceLabel,
        browserFingerprint: input.browserFingerprint,
        registeredAt: new Date()
      });

      if (!device) {
        return createBranchSetupNotFoundError();
      }

      await options.repository.replaceActiveRegistrations(pendingSetup.branchId, device.id, new Date());

      const branch = await options.repository.findBranchById(pendingSetup.branchId);

      if (!branch) {
        return createBranchNotFoundError();
      }

      return buildBranchDeviceState(branch, device, null);
    },

    async revokeSetupLink(branchId: number, revokedByAdminId: number) {
      const branch = await options.repository.findBranchById(branchId);

      if (!branch) {
        return createBranchNotFoundError();
      }

      const beforeState = buildBranchDeviceState(
        branch,
        await options.repository.findActiveRegistration(branch.id),
        await options.repository.findPendingSetupLink(branch.id)
      );

      await options.repository.revokePendingSetupLinks(branch.id, new Date());

      const afterState = buildBranchDeviceState(
        branch,
        await options.repository.findActiveRegistration(branch.id),
        await options.repository.findPendingSetupLink(branch.id)
      );

      await options.auditLogService?.recordAuditLog({
        adminId: revokedByAdminId,
        actionType: "setup_link_revoke",
        entityType: "branch_device",
        entityId: String(branch.id),
        entityDisplayName: branch.name,
        before: branchDeviceStateToAuditPayload(beforeState),
        after: branchDeviceStateToAuditPayload(afterState)
      });

      return { success: true } as const;
    }
  };
}

function createBranchNotFoundError(): BranchErrorResult {
  return {
    error: {
      code: "BRANCH_NOT_FOUND",
      message: "Branch not found",
      details: {}
    }
  };
}

function createBranchSetupNotFoundError(): BranchErrorResult {
  return {
    error: {
      code: "BRANCH_SETUP_NOT_FOUND",
      message: "Branch setup link not found",
      details: {}
    }
  };
}

function createBranchSetupExpiredError(): BranchErrorResult {
  return {
    error: {
      code: "BRANCH_SETUP_EXPIRED",
      message: "Branch setup link expired",
      details: {}
    }
  };
}

function buildBranchDeviceState(
  branch: BranchRecord,
  activeDevice: BranchDeviceRegistrationRecord | null,
  pendingSetup: BranchSetupLinkRecord | null
) {
  return {
    branch,
    activeDevice: activeDevice ? {
      id: activeDevice.id,
      deviceToken: activeDevice.deviceToken,
      deviceLabel: activeDevice.deviceLabel,
      browserFingerprint: activeDevice.browserFingerprint,
      registeredAt: activeDevice.registeredAt
    } : null,
    pendingSetup: pendingSetup ? {
      id: pendingSetup.id,
      token: pendingSetup.token,
      deviceLabel: pendingSetup.deviceLabel,
      expiresAt: pendingSetup.expiresAt
    } : null
  };
}

function branchDeviceStateToAuditPayload(state: ReturnType<typeof buildBranchDeviceState>) {
  return {
    branchId: state.branch.id,
    setupStatus: state.branch.setupStatus,
    activeDevice: state.activeDevice ? {
      id: state.activeDevice.id,
      deviceToken: state.activeDevice.deviceToken,
      deviceLabel: state.activeDevice.deviceLabel,
      browserFingerprint: state.activeDevice.browserFingerprint
    } : null,
    pendingSetup: state.pendingSetup ? {
      id: state.pendingSetup.id,
      token: state.pendingSetup.token,
      deviceLabel: state.pendingSetup.deviceLabel,
      expiresAt: state.pendingSetup.expiresAt.toISOString()
    } : null
  };
}

function createSetupToken() {
  return randomBytes(32).toString("base64url");
}
