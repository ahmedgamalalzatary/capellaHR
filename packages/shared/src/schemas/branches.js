import { z } from "zod";
import { branchSetupStatusSchema } from "./common.js";
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
export const branchSearchSchema = z.object({
    search: z.string().trim().optional()
});
