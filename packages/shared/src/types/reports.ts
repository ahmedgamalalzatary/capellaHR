import type { z } from "zod";
import type { monthlyAttendanceSummaryFilterSchema } from "../schemas/reports.js";

export type MonthlyAttendanceSummaryFilterInput = z.infer<typeof monthlyAttendanceSummaryFilterSchema>;
