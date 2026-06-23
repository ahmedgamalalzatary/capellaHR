import type { BranchSearchInput } from "@capella/shared/contracts";

import { api } from "@/shared/lib/api-client";
import type {
  BranchDeviceResponse,
  BranchListResponse,
  BranchResponse,
  BranchWritePayload
} from "@/features/branches/branches.types";

export const branchesApi = {
  /** Paginated, optionally searched list of branches. */
  list: (filters?: Partial<BranchSearchInput>) =>
    api.get<BranchListResponse>("/branches", { query: filters }),

  /** Single branch by id; throws ApiError(404) when missing. */
  get: (branchId: number) => api.get<BranchResponse>(`/branches/${branchId}`),

  create: (input: BranchWritePayload) => api.post<BranchResponse>("/branches", { json: input }),

  update: (branchId: number, input: Partial<BranchWritePayload>) =>
    api.patch<BranchResponse>(`/branches/${branchId}`, { json: input }),

  /** Current device/setup state for a branch. */
  getDevice: (branchId: number) =>
    api.get<BranchDeviceResponse>(`/branches/${branchId}/device`)
};
