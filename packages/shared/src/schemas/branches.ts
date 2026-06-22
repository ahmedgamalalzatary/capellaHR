import { z } from "zod";
import { branchSetupStatusSchema, paginationSchema } from "./common";

export const branchCreateSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
  gpsLatitude: z.union([z.string(), z.number()]).transform((value) => String(value)),
  gpsLongitude: z.union([z.string(), z.number()]).transform((value) => String(value)),
  gpsRadiusMeters: z.number().int().positive(),
  allowedIpCidr: z.string().trim().min(1),
  setupStatus: branchSetupStatusSchema.default("setup_pending")
});

export const branchUpdateSchema = branchCreateSchema.partial();

export const branchSearchSchema = paginationSchema.extend({
  search: z.string().trim().optional()
});

export const branchSetupLinkCreateSchema = z.object({
  deviceLabel: z.string().trim().min(1).max(255).optional()
});

export const branchSetupCompletionSchema = z.object({
  deviceLabel: z.string().trim().min(1).max(255).optional(),
  browserFingerprint: z.string().trim().min(1).max(255)
});
