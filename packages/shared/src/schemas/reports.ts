import { z } from "zod";

export const monthlyAttendanceSummaryFilterSchema = z.object({
  employeeId: z.coerce.number().int().positive().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/)
});
