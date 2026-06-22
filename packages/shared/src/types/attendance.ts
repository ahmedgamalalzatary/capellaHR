import type { z } from "zod";
import type {
  adminAttendanceCreateSchema,
  adminAttendanceDeleteSchema,
  adminAttendanceUpdateSchema,
  attendanceActionSchema,
  attendanceListFilterSchema
} from "../schemas/attendance";
import type { attendanceActionTypeSchema, attendanceSessionStatusSchema } from "../schemas/common";

export type AttendanceActionType = z.infer<typeof attendanceActionTypeSchema>;
export type AttendanceSessionStatus = z.infer<typeof attendanceSessionStatusSchema>;
export type AttendanceActionInput = z.infer<typeof attendanceActionSchema>;
export type AttendanceListFilterInput = z.infer<typeof attendanceListFilterSchema>;
export type AdminAttendanceCreateInput = z.infer<typeof adminAttendanceCreateSchema>;
export type AdminAttendanceUpdateInput = z.infer<typeof adminAttendanceUpdateSchema>;
export type AdminAttendanceDeleteInput = z.infer<typeof adminAttendanceDeleteSchema>;
