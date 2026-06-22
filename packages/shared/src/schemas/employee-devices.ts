import { z } from "zod";

export const employeeDeviceSetupLinkCreateSchema = z.object({
  deviceLabel: z.string().trim().min(1).max(255).optional()
});

export const employeeDeviceSetupCompletionSchema = z.object({
  deviceLabel: z.string().trim().min(1).max(255).optional(),
  browserFingerprint: z.string().trim().min(1).max(255)
});
