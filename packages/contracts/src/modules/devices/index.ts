import { z } from 'zod';
import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
  positiveMysqlIntSchema,
} from '../../common/index.js';

export const deviceAssignmentSchema = z.object({ assignmentType: z.enum(['employee', 'branch']), assignmentId: positiveMysqlIntSchema }).strict();
export const pairingTokenParamsSchema = z.object({ token: z.string().min(20).max(512) });
export const deviceIdParamsSchema = z.object({ id: coercedMysqlIntSchema });

export const completeDevicePairingSchema = z.object({
  installationMarker: z.string().min(16).max(4096), browser: z.string().trim().min(1).max(255),
  platform: z.string().trim().min(1).max(255),
}).strict();
export const listDevicesQuerySchema = z.object({ search: z.string().trim().min(1).max(255).optional(), assignmentType: z.enum(['employee', 'branch']).optional(), assignmentId: coercedMysqlIntSchema.optional(), status: z.enum(['active', 'revoked']).optional(), page: paginationPageSchema.default(1), pageSize: paginationPageSizeSchema.default(20) }).superRefine((value, context) => {
  if (value.assignmentId !== undefined && value.assignmentType === undefined) context.addIssue({ code: 'custom', path: ['assignmentType'], message: 'assignmentType is required with assignmentId' });
});

export type DeviceAssignment = z.infer<typeof deviceAssignmentSchema>;
export type CompleteDevicePairing = z.infer<typeof completeDevicePairingSchema>;
export type ListDevicesQuery = z.infer<typeof listDevicesQuerySchema>;
