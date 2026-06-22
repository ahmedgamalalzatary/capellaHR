import type { z } from "zod";
import type {
  permissionAbsenceCreateSchema,
  permissionAbsenceListFilterSchema,
  permissionAbsenceUpdateSchema
} from "../schemas/permission-absences";

export type PermissionAbsenceCreateInput = z.infer<typeof permissionAbsenceCreateSchema>;
export type PermissionAbsenceUpdateInput = z.infer<typeof permissionAbsenceUpdateSchema>;
export type PermissionAbsenceListFilterInput = z.infer<typeof permissionAbsenceListFilterSchema>;
