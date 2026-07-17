import { z } from 'zod';
import { verifyDeviceSchema } from '../devices/index.js';

export const adminLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
}).strict();

export const employeeLoginSchema = z.object({
  employeeCode: z.number().int().positive(),
  pin: z.string().regex(/^\d{4}$/),
  personalPhone: z.string().regex(/^01(?:0|1|2|5)\d{8}$/),
  deviceProof: verifyDeviceSchema,
}).strict();

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type EmployeeLoginInput = z.infer<typeof employeeLoginSchema>;
