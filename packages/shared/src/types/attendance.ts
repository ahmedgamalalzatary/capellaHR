import type { z } from "zod";
import type { attendanceActionSchema, attendanceListFilterSchema } from "../schemas/attendance.js";
import type { attendanceActionTypeSchema, attendanceSessionStatusSchema } from "../schemas/common.js";

export type AttendanceActionType = z.infer<typeof attendanceActionTypeSchema>;
export type AttendanceSessionStatus = z.infer<typeof attendanceSessionStatusSchema>;
export type AttendanceActionInput = z.infer<typeof attendanceActionSchema>;
export type AttendanceListFilterInput = z.infer<typeof attendanceListFilterSchema>;
