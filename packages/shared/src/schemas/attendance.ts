import { z } from "zod";
import { attendanceActionTypeSchema, attendanceSessionStatusSchema } from "./common.js";

export const attendanceActionSchema = z.object({
  action: attendanceActionTypeSchema,
  latitude: z.number(),
  longitude: z.number(),
  deviceId: z.string().trim().min(1)
});

export const attendanceListFilterSchema = z.object({
  employeeName: z.string().trim().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  status: attendanceSessionStatusSchema.optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional()
});
