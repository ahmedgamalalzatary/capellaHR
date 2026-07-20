import { z } from 'zod';

import { paginationPageSchema, paginationPageSizeSchema } from '../../common/index.js';

export const auditActorTypeSchema = z.enum(['admin', 'employee', 'system']);

const calendarDateSchema = z.string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, 'التاريخ غير صالح');

const filterText = z.string().trim().min(1).max(128);

export const listAuditEventsQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  actorType: auditActorTypeSchema.optional(),
  module: filterText.optional(),
  action: filterText.optional(),
  entityType: filterText.optional(),
  entityId: filterText.optional(),
  requestId: z.string().trim().min(1).max(64).optional(),
  dateFrom: calendarDateSchema.optional(),
  dateTo: calendarDateSchema.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).strict().superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({
      code: 'custom',
      path: ['dateTo'],
      message: 'نهاية الفترة يجب ألا تسبق بدايتها',
    });
  }
});

export type AuditActorType = z.infer<typeof auditActorTypeSchema>;
export type ListAuditEventsQuery = z.infer<typeof listAuditEventsQuerySchema>;

export interface AuditEventDto {
  id: number;
  actorType: AuditActorType;
  actorIdentifier: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  beforeState: unknown;
  afterState: unknown;
  relatedIds: Record<string, string> | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}
