import { z } from 'zod';

export const deviceAssignmentSchema = z.object({ assignmentType: z.enum(['employee', 'branch']), assignmentId: z.coerce.number().int().positive() }).strict();
export const pairingTokenParamsSchema = z.object({ token: z.string().min(20).max(512) });
export const deviceIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });

const clientExtensionsSchema = z.record(z.unknown()).default({});
export const registrationResponseSchema = z.object({
  id: z.string().min(1).max(4096), rawId: z.string().min(1).max(4096), type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: z.string().min(1), attestationObject: z.string().min(1),
    transports: z.array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])).optional(),
    authenticatorData: z.string().optional(), publicKey: z.string().optional(), publicKeyAlgorithm: z.number().int().optional(),
  }).strict(),
  clientExtensionResults: clientExtensionsSchema,
  authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
}).strict();

export const authenticationResponseSchema = z.object({
  id: z.string().min(1).max(4096), rawId: z.string().min(1).max(4096), type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: z.string().min(1), authenticatorData: z.string().min(1), signature: z.string().min(1), userHandle: z.string().optional(),
  }).strict(),
  clientExtensionResults: clientExtensionsSchema,
  authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
}).strict();

export const completeDevicePairingSchema = z.object({
  installationMarker: z.string().min(16).max(4096), browser: z.string().trim().min(1).max(255),
  platform: z.string().trim().min(1).max(255), response: registrationResponseSchema,
}).strict();
export const beginEmployeeDeviceAuthenticationSchema = z.object({ employeeCode: z.number().int().positive(), installationMarker: z.string().min(16).max(4096) }).strict();
export const verifyDeviceSchema = z.object({ challengeId: z.string().uuid(), installationMarker: z.string().min(16).max(4096), response: authenticationResponseSchema }).strict();
export const listDevicesQuerySchema = z.object({ assignmentType: z.enum(['employee', 'branch']).optional(), assignmentId: z.coerce.number().int().positive().optional(), status: z.enum(['active', 'revoked']).optional(), page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(100).default(20) }).superRefine((value, context) => {
  if (value.assignmentId !== undefined && value.assignmentType === undefined) context.addIssue({ code: 'custom', path: ['assignmentType'], message: 'assignmentType is required with assignmentId' });
});

export type DeviceAssignment = z.infer<typeof deviceAssignmentSchema>;
export type CompleteDevicePairing = z.infer<typeof completeDevicePairingSchema>;
export type VerifyDevice = z.infer<typeof verifyDeviceSchema>;
export type ListDevicesQuery = z.infer<typeof listDevicesQuerySchema>;
