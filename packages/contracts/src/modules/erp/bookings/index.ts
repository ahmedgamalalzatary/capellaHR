import { z } from 'zod';

import { coercedMysqlIntSchema, positiveMysqlIntSchema } from '../../../common/index.ts';
import {
  exactMoneySchema,
  paymentMethodSchema,
  positiveMoneySchema,
} from '../sales/index.ts';

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

/** Money handed back to the client out of an open shift's drawer. */
export const bookingRefundInputSchema = z.object({
  cashierSessionId: positiveMysqlIntSchema,
  payments: z.array(z.object({
    method: paymentMethodSchema,
    amount: positiveMoneySchema,
  }).strict()).min(1).max(paymentMethodSchema.options.length),
  operationReference: z.string().uuid(),
}).strict();

/** Converted is written only by the trusted sale transaction. */
export const updateBookingStatusSchema = z.object({
  status: z.enum(['arrived', 'booked', 'cancelled', 'no_show']),
  branchId: coercedMysqlIntSchema.optional(),
  refund: bookingRefundInputSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.refund !== undefined && value.status !== 'cancelled' && value.status !== 'no_show') {
    context.addIssue({
      code: 'custom',
      path: ['refund'],
      message: 'رد المقدم مسموح فقط عند إلغاء الحجز أو عدم حضور العميل',
    });
  }
});

export const updateBookingServicePreferenceSchema = z.object({
  preferredEmployeeId: coercedMysqlIntSchema.nullable(),
  branchId: coercedMysqlIntSchema.optional(),
}).strict();

export const recordBookingPaymentSchema = z.object({
  branchId: positiveMysqlIntSchema.optional(),
  cashierSessionId: positiveMysqlIntSchema,
  method: paymentMethodSchema,
  amount: positiveMoneySchema,
  operationReference: z.string().uuid(),
}).strict();

export const cancelBookingServicesSchema = z.object({
  branchId: positiveMysqlIntSchema.optional(),
  serviceIds: z.array(positiveMysqlIntSchema).min(1),
  refund: bookingRefundInputSchema.optional(),
}).strict().superRefine((value, context) => {
  const seen = new Set<number>();
  value.serviceIds.forEach((serviceId, index) => {
    if (seen.has(serviceId)) {
      context.addIssue({
        code: 'custom',
        path: ['serviceIds', index],
        message: 'لا يمكن تكرار الخدمة',
      });
    }
    seen.add(serviceId);
  });
});

export const rescheduleBookingSchema = z.object({
  branchId: positiveMysqlIntSchema.optional(),
  scheduledAt: z.string().datetime({ offset: true }),
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

const bookingServiceStatusSchema = z.enum(['pending', 'sold', 'cancelled']);
const bookingQueueStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'overdue', 'canceled']);

/** Derived from the booking payments ledger; never stored. */
const bookingMoneySchema = z.object({
  paid: exactMoneySchema,
  refunded: exactMoneySchema,
  applied: exactMoneySchema,
  held: exactMoneySchema,
  pendingValue: exactMoneySchema,
  maxPayable: exactMoneySchema,
  excess: exactMoneySchema,
});

export const bookingDtoSchema = z.object({
  id: coercedMysqlIntSchema,
  branchId: coercedMysqlIntSchema,
  client: bookingClientSchema,
  scheduledAt: z.string().datetime(),
  status: bookingStatusSchema,
  note: z.string().nullable(),
  money: bookingMoneySchema,
  services: z.array(z.object({
    serviceId: coercedMysqlIntSchema,
    serviceName: z.string(),
    servicePrice: z.string().regex(/^\d{1,10}\.\d{2}$/).nullable(),
    preferredEmployee: preferredEmployeeSchema.nullable(),
    status: bookingServiceStatusSchema,
    invoiceId: coercedMysqlIntSchema.nullable(),
    invoiceNumber: z.string().nullable(),
    queueStatus: bookingQueueStatusSchema.nullable(),
  })),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export type BookingServiceStatus = z.infer<typeof bookingServiceStatusSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;
export type UpdateBookingServicePreferenceInput = z.infer<typeof updateBookingServicePreferenceSchema>;
export type RecordBookingPaymentInput = z.infer<typeof recordBookingPaymentSchema>;
export type CancelBookingServicesInput = z.infer<typeof cancelBookingServicesSchema>;
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;
export type BookingRefundInput = z.infer<typeof bookingRefundInputSchema>;
export type BookingDto = z.infer<typeof bookingDtoSchema>;
