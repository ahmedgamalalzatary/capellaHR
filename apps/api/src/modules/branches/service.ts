import type { BranchCreateInput, BranchSearchInput, BranchUpdateInput } from "@capella/shared";
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
};

export function createBranchService(options: CreateBranchServiceOptions) {
  return {
    async createBranch(input: BranchCreateInput, createdByAdminId: number) {
      void createdByAdminId;
      return options.repository.createBranch(input);
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
      void updatedByAdminId;

      const branch = await options.repository.updateBranch(branchId, input);

      if (!branch) {
        return createBranchNotFoundError();
      }

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
