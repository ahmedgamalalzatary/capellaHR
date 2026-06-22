import { z } from "zod";
import { attendanceActionTypeSchema, attendanceSessionStatusSchema } from "./common";

const isoDateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeSchema = z.string().trim().datetime({ offset: true });
const adminAttendanceSortBySchema = z.enum(["check_in_at", "employee_name"]);
const sortDirectionSchema = z.enum(["asc", "desc"]);

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
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
  sortBy: adminAttendanceSortBySchema.optional(),
  sortDirection: sortDirectionSchema.optional()
});

export const adminAttendanceCreateSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  branchId: z.coerce.number().int().positive(),
  checkInAt: isoDateTimeSchema,
  checkOutAt: isoDateTimeSchema.optional(),
  reason: z.string().trim().min(1)
});

export const adminAttendanceUpdateSchema = z.object({
  branchId: z.coerce.number().int().positive(),
  checkInAt: isoDateTimeSchema,
  checkOutAt: isoDateTimeSchema.optional(),
  reason: z.string().trim().min(1)
});

export const adminAttendanceDeleteSchema = z.object({
  reason: z.string().trim().min(1)
});
