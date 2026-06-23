import type { BranchSearchInput } from "@capella/shared/contracts";

/** Query-key factory for the branches feature. */
export const branchKeys = {
  all: ["branches"] as const,
  lists: () => [...branchKeys.all, "list"] as const,
  list: (filters?: Partial<BranchSearchInput>) => [...branchKeys.lists(), filters ?? {}] as const,
  details: () => [...branchKeys.all, "detail"] as const,
  detail: (branchId: number) => [...branchKeys.details(), branchId] as const,
  device: (branchId: number) => [...branchKeys.detail(branchId), "device"] as const
};
