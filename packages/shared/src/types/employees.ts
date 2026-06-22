import type { z } from "zod";
import type {
  employeeBranchAssignmentCreateSchema,
  employeeCreateSchema,
  employeeListFilterSchema,
  employeeUpdateSchema
} from "../schemas/employees";

export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
export type EmployeeListFilterInput = z.infer<typeof employeeListFilterSchema>;
export type EmployeeBranchAssignmentCreateInput = z.infer<typeof employeeBranchAssignmentCreateSchema>;
