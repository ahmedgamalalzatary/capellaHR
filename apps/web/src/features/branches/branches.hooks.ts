import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BranchSearchInput } from "@capella/shared/contracts";

import { branchesApi } from "@/features/branches/branches.api";
import { branchKeys } from "@/features/branches/branches.keys";
import type { BranchWritePayload } from "@/features/branches/branches.types";

export function useBranches(filters?: Partial<BranchSearchInput>) {
  return useQuery({
    queryKey: branchKeys.list(filters),
    queryFn: () => branchesApi.list(filters)
  });
}

export function useBranch(branchId: number) {
  return useQuery({
    queryKey: branchKeys.detail(branchId),
    queryFn: () => branchesApi.get(branchId),
    enabled: Number.isFinite(branchId) && branchId > 0
  });
}

export function useBranchDevice(branchId: number) {
  return useQuery({
    queryKey: branchKeys.device(branchId),
    queryFn: () => branchesApi.getDevice(branchId),
    enabled: Number.isFinite(branchId) && branchId > 0
  });
}

export function useCreateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BranchWritePayload) => branchesApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: branchKeys.lists() });
    }
  });
}

export function useUpdateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, input }: { branchId: number; input: Partial<BranchWritePayload> }) =>
      branchesApi.update(branchId, input),
    onSuccess: (_data, { branchId }) => {
      queryClient.invalidateQueries({ queryKey: branchKeys.lists() });
      queryClient.invalidateQueries({ queryKey: branchKeys.detail(branchId) });
    }
  });
}
