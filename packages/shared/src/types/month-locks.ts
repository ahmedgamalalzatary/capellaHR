import type { z } from "zod";
import type {
  monthLockCreateSchema,
  monthLockListFilterSchema
} from "../schemas/month-locks";

export type MonthLockCreateInput = z.infer<typeof monthLockCreateSchema>;
export type MonthLockListFilterInput = z.infer<typeof monthLockListFilterSchema>;
