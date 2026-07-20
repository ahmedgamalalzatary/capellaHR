import { containsArabicIndicDigits } from '@capella/shared';
import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
  positiveMysqlIntSchema,
} from '../../common/index.js';
import { verifyDeviceSchema } from '../devices/index.js';
import { cairoDateSchema } from '../weekly-day-off/index.js';

export const attendanceEventTypeSchema = z.enum(['check_in', 'check_out']);
export const employeeAttendanceSourceSchema = z.enum(['personal_device', 'branch_device']);
export const attendanceEventSourceSchema = z.enum([
  'personal_device',
  'branch_device',
  'admin_manual',
  'admin_approved_denied',
  'automatic_timeout',
]);

const attendancePinSchema = z.string().superRefine((value, context) => {
  if (containsArabicIndicDigits(value)) {
    context.addIssue({ code: 'custom', message: 'استخدم الأرقام الإنجليزية من 0 إلى 9' });
  }
}).pipe(z.string().regex(/^\d{4}$/, 'الرقم السري يجب أن يتكون من أربعة أرقام'));

export const attendanceGpsSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  gpsAccuracyMeters: z.number().finite().nonnegative(),
}).strict();

export const employeeAttendanceEventSchema = z.object({
  employeeCode: positiveMysqlIntSchema,
  pin: attendancePinSchema,
  source: employeeAttendanceSourceSchema,
  latitude: attendanceGpsSchema.shape.latitude,
  longitude: attendanceGpsSchema.shape.longitude,
  gpsAccuracyMeters: attendanceGpsSchema.shape.gpsAccuracyMeters,
  deviceProof: verifyDeviceSchema,
}).strict();

export const beginAttendanceDeviceAuthenticationSchema = z.object({
  employeeCode: positiveMysqlIntSchema,
  source: employeeAttendanceSourceSchema,
  installationMarker: z.string().min(16).max(4096),
}).strict();

const explicitOffsetDateTimeSchema = z.string().datetime({ offset: true })
  .transform((value) => new Date(value));

export const manualAttendanceEventSchema = z.object({
  employeeId: positiveMysqlIntSchema,
  occurredAt: explicitOffsetDateTimeSchema,
}).strict();

export const attendanceSessionParamsSchema = z.object({ sessionId: coercedMysqlIntSchema });
export const attendanceDeniedAttemptParamsSchema = z.object({ attemptId: coercedMysqlIntSchema });

export const correctAutomaticTimeoutSchema = z.object({
  checkOutAt: explicitOffsetDateTimeSchema,
}).strict();

const dateRange = {
  dateFrom: cairoDateSchema.optional(),
  dateTo: cairoDateSchema.optional(),
};
const validateDateRange = (
  value: { dateFrom?: string | undefined; dateTo?: string | undefined },
  context: z.RefinementCtx,
) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({
      code: 'custom', path: ['dateTo'],
      message: 'تاريخ النهاية يجب ألا يسبق تاريخ البداية',
    });
  }
};

export const listAttendanceSessionsQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  employeeId: coercedMysqlIntSchema.optional(),
  branchId: coercedMysqlIntSchema.optional(),
  state: z.enum(['open', 'closed']).optional(),
  ...dateRange,
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).superRefine(validateDateRange);

export const listAttendanceDeniedAttemptsQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  employeeId: coercedMysqlIntSchema.optional(),
  branchId: coercedMysqlIntSchema.optional(),
  eventType: attendanceEventTypeSchema.optional(),
  suspicious: z.preprocess(
    (value) => value === 'true' ? true : value === 'false' ? false : value,
    z.boolean(),
  ).optional(),
  approvalState: z.enum(['pending', 'approved', 'dismissed']).optional(),
  ...dateRange,
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).superRefine(validateDateRange);

export type EmployeeAttendanceEvent = z.infer<typeof employeeAttendanceEventSchema>;
export type BeginAttendanceDeviceAuthentication = z.infer<typeof beginAttendanceDeviceAuthenticationSchema>;
export type ManualAttendanceEvent = z.infer<typeof manualAttendanceEventSchema>;
export type ListAttendanceSessionsQuery = z.infer<typeof listAttendanceSessionsQuerySchema>;
export type ListAttendanceDeniedAttemptsQuery = z.infer<typeof listAttendanceDeniedAttemptsQuerySchema>;
export type AttendanceEventType = z.infer<typeof attendanceEventTypeSchema>;
export type AttendanceEventSource = z.infer<typeof attendanceEventSourceSchema>;
