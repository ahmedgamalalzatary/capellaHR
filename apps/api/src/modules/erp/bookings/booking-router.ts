import {
  bookingIdParamsSchema,
  bookingServiceParamsSchema,
  createBookingSchema,
  listBookingsQuerySchema,
  updateBookingStatusSchema,
  updateBookingServicePreferenceSchema,
} from '@capella/contracts';
import { Router, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { BookingError, type BookingService } from './booking-service.js';

const actorFrom = (response: Response): ErpAccountIdentity => {
  const actor = erpActorFromLocals(response.locals.actor);
  if (!actor) throw new ErpBranchContextError('ERP_BRANCH_FORBIDDEN', 'غير مصرح لك بهذا الإجراء');
  return actor;
};
const optionalBranch = (value: unknown) => value === undefined
  ? undefined
  : bookingIdParamsSchema.shape.id.parse(value);

const failure = (response: Response, status: number, code: string, message: string, extra = {}) => (
  response.status(status).json({
    error: { code, message, ...extra, requestId: responseRequestId(response) },
  })
);

const handle = (cause: unknown, response: Response) => {
  if (cause instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of cause.issues) {
      (fieldErrors[issue.path.join('.') || '_root'] ??= []).push(issue.message);
    }
    failure(response, 400, 'VALIDATION_ERROR', 'بيانات الحجز غير صالحة', { fieldErrors });
    return;
  }
  if (cause instanceof BookingError) {
    const status = cause.code === 'BOOKING_NOT_FOUND' ? 404 : 409;
    failure(response, status, cause.code, cause.message);
    return;
  }
  if (cause instanceof ErpBranchContextError) {
    const status = cause.code === 'ERP_BRANCH_REQUIRED' ? 400
      : cause.code === 'ERP_BRANCH_NOT_FOUND' ? 404 : 403;
    failure(response, status, cause.code, cause.message);
    return;
  }
  throw cause;
};

export const createErpBookingsRouter = (service: BookingService) => {
  const router = Router();
  router.post('/', async (request, response) => {
    try {
      const input = createBookingSchema.parse(request.body);
      response.status(201).json({ data: await service.create(actorFrom(response), input) });
    } catch (cause) { handle(cause, response); }
  });
  router.get('/', async (request, response) => {
    try {
      const query = listBookingsQuerySchema.parse(request.query);
      response.json({ data: await service.listDay(actorFrom(response), query) });
    } catch (cause) { handle(cause, response); }
  });
  router.get('/employee-options', async (request, response) => {
    try {
      const branchId = optionalBranch(request.query.branchId);
      response.json({ data: await service.listEmployeeOptions(actorFrom(response), branchId) });
    } catch (cause) { handle(cause, response); }
  });
  router.get('/:id', async (request, response) => {
    try {
      const { id } = bookingIdParamsSchema.parse(request.params);
      const branchId = optionalBranch(request.query.branchId);
      response.json({ data: await service.get(actorFrom(response), id, branchId) });
    } catch (cause) { handle(cause, response); }
  });
  router.patch('/:id/status', async (request, response) => {
    try {
      const { id } = bookingIdParamsSchema.parse(request.params);
      const input = updateBookingStatusSchema.parse(request.body);
      response.json({ data: await service.updateStatus(actorFrom(response), id, input) });
    } catch (cause) { handle(cause, response); }
  });
  router.patch('/:id/services/:serviceId/preference', async (request, response) => {
    try {
      const { id, serviceId } = bookingServiceParamsSchema.parse(request.params);
      const input = updateBookingServicePreferenceSchema.parse(request.body);
      response.json({ data: await service.updatePreference(actorFrom(response), id, serviceId, input) });
    } catch (cause) { handle(cause, response); }
  });
  return router;
};
