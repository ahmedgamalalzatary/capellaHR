import type { z } from "zod";
import type {
  weeklyDayOffAssignmentCreateSchema,
  weeklyDayOffAssignmentListFilterSchema,
  weeklyDayOffAssignmentUpdateSchema
} from "../schemas/weekly-day-offs";

export type WeeklyDayOffAssignmentCreateInput = z.infer<typeof weeklyDayOffAssignmentCreateSchema>;
export type WeeklyDayOffAssignmentUpdateInput = z.infer<typeof weeklyDayOffAssignmentUpdateSchema>;
export type WeeklyDayOffAssignmentListFilterInput = z.infer<typeof weeklyDayOffAssignmentListFilterSchema>;
