import type { z } from "zod";
import type { branchCreateSchema, branchSearchSchema, branchUpdateSchema } from "../schemas/branches.js";
import type { branchSetupStatusSchema } from "../schemas/common.js";

export type BranchSetupStatus = z.infer<typeof branchSetupStatusSchema>;
export type BranchCreateInput = z.infer<typeof branchCreateSchema>;
export type BranchUpdateInput = z.infer<typeof branchUpdateSchema>;
export type BranchSearchInput = z.infer<typeof branchSearchSchema>;
