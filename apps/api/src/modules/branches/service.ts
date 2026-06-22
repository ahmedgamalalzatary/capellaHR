import type { BranchCreateInput, BranchSearchInput, BranchUpdateInput } from "@capella/shared";
import type { createAuditLogService } from "../audit-logs/service";
import type { BranchRecord } from "./repository";

type BranchErrorResult = {
  error: {
    code: "BRANCH_NOT_FOUND";
    message: string;
    details: Record<string, unknown>;
  };
};

export type BranchRepository = {
  createBranch(input: BranchCreateInput): Promise<BranchRecord>;
  listBranches(filters: BranchSearchInput): Promise<BranchRecord[]>;
  findBranchById(branchId: number): Promise<BranchRecord | null>;
  updateBranch(branchId: number, input: BranchUpdateInput): Promise<BranchRecord | null>;
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
