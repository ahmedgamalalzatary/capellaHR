import type { z } from "zod";
import type {
  employeeDeviceSetupCompletionSchema,
  employeeDeviceSetupLinkCreateSchema
} from "../schemas/employee-devices";

export type EmployeeDeviceSetupLinkCreateInput = z.infer<typeof employeeDeviceSetupLinkCreateSchema>;
export type EmployeeDeviceSetupCompletionInput = z.infer<typeof employeeDeviceSetupCompletionSchema>;
