import { z } from 'zod';
export const deviceAssignmentSchema = z.object({ assignmentType: z.enum(['employee', 'branch']), assignmentId: z.coerce.number().int().positive() }).strict();
export const pairingTokenParamsSchema = z.object({ token: z.string().min(20).max(512) });
export const deviceIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
export const completeDevicePairingSchema = z.object({ credentialId: z.string().min(1).max(4096), publicKey: z.string().min(1).max(16384), installationMarker: z.string().min(1).max(4096), browser: z.string().trim().min(1).max(255), platform: z.string().trim().min(1).max(255) }).strict();
export const verifyDeviceSchema = completeDevicePairingSchema.pick({ credentialId: true, installationMarker: true });
export const listDevicesQuerySchema = z.object({ assignmentType: z.enum(['employee', 'branch']).optional(), assignmentId: z.coerce.number().int().positive().optional(), status: z.enum(['active', 'revoked']).optional(), page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(100).default(20) }).superRefine((value, context) => {
  if (value.assignmentId !== undefined && value.assignmentType === undefined) context.addIssue({ code: 'custom', path: ['assignmentType'], message: 'assignmentType is required with assignmentId' });
});
export type DeviceAssignment = z.infer<typeof deviceAssignmentSchema>;
export type CompleteDevicePairing = z.infer<typeof completeDevicePairingSchema>;
export type VerifyDevice = z.infer<typeof verifyDeviceSchema>;
export type ListDevicesQuery = z.infer<typeof listDevicesQuerySchema>;
