import { z } from 'zod';

import { coercedMysqlIntSchema } from '../../../common/index.js';

export const bookingStatusSchema = z.enum([
  'booked',
  'arrived',
  'converted',
  'cancelled',
  'no_show',
]);

const bookingServiceInputSchema = z.object({
  serviceId: coercedMysqlIntSchema,
  preferredEmployeeId: coercedMysqlIntSchema.optional(),
}).strict();

export const createBookingSchema = z.object({
  branchId: coercedMysqlIntSchema.optional(),
  clientId: coercedMysqlIntSchema,
  scheduledAt: z.string().datetime({ offset: true }),
  note: z.string().trim().max(1000).nullable().optional(),
  services: z.array(bookingServiceInputSchema).min(1),
}).strict().superRefine((value, context) => {
  const seen = new Set<number>();
  value.services.forEach((service, index) => {
    if (seen.has(service.serviceId)) {
      context.addIssue({
        code: 'custom',
        path: ['services', index, 'serviceId'],
        message: 'لا يمكن إضافة نفس الخدمة مرتين إلى الحجز',
      });
    }
    seen.add(service.serviceId);
  });
});

export const listBookingsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const candidate = new Date(Date.UTC(year, month - 1, day));
    return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1
      && candidate.getUTCDate() === day;
  }, 'Invalid calendar date'),
  branchId: coercedMysqlIntSchema.optional(),
}).strict();

export const bookingIdParamsSchema = z.object({ id: coercedMysqlIntSchema }).strict();
export const bookingServiceParamsSchema = z.object({
  id: coercedMysqlIntSchema,
  serviceId: coercedMysqlIntSchema,
}).strict();

/** Converted is written only by the trusted sale transaction. */
export const updateBookingStatusSchema = z.object({
  status: z.enum(['arrived', 'booked', 'cancelled', 'no_show']),
  branchId: coercedMysqlIntSchema.optional(),
}).strict();

export const updateBookingServicePreferenceSchema = z.object({
  preferredEmployeeId: coercedMysqlIntSchema.nullable(),
  branchId: coercedMysqlIntSchema.optional(),
}).strict();

const bookingClientSchema = z.object({
  id: coercedMysqlIntSchema,
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
});

const preferredEmployeeSchema = z.object({
  id: coercedMysqlIntSchema,
  name: z.string(),
});

export const bookingDtoSchema = z.object({
  id: coercedMysqlIntSchema,
  branchId: coercedMysqlIntSchema,
  client: bookingClientSchema,
  scheduledAt: z.string().datetime(),
  status: bookingStatusSchema,
  note: z.string().nullable(),
  invoiceId: coercedMysqlIntSchema.nullable(),
  services: z.array(z.object({
    serviceId: coercedMysqlIntSchema,
    serviceName: z.string(),
    servicePrice: z.string().regex(/^\d{1,10}\.\d{2}$/).nullable(),
    preferredEmployee: preferredEmployeeSchema.nullable(),
  })),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;
export type UpdateBookingServicePreferenceInput = z.infer<typeof updateBookingServicePreferenceSchema>;
export type BookingDto = z.infer<typeof bookingDtoSchema>;
