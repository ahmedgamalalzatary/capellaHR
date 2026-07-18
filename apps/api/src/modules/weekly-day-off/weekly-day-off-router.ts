import {
  listWeeklyDayRecordsQuerySchema,
  weeklyDayRecordParamsSchema,
} from '@capella/contracts';
import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../shared/http/index.js';
import { createAuthMiddleware } from '../auth/auth-middleware.js';
import type { AuthService } from '../auth/auth-service.js';
import {
  WeeklyDayOffError,
  type WeeklyDayOffService,
} from './weekly-day-off-service.js';

const fail = (
  response: Response,
  status: number,
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>,
) => response.status(status).json({
  error: {
    code,
    message,
    ...(fieldErrors ? { fieldErrors } : {}),
    requestId: responseRequestId(response),
  },
});

const handleError = (error: unknown, response: Response) => {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = issue.path.join('.') || '_root';
      (fieldErrors[field] ??= []).push(issue.message);
    }
    fail(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', fieldErrors);
    return;
  }
  if (error instanceof WeeklyDayOffError) {
    const status = error.code === 'WEEKLY_DAY_RECORD_NOT_FOUND' ? 404 : 409;
    fail(response, status, error.code, error.message);
    return;
  }
  throw error;
};

export const createWeeklyDayOffRouter = (
  service: WeeklyDayOffService,
  authService: Pick<AuthService, 'authenticate'>,
) => {
  const router = Router();
  const auth = createAuthMiddleware(authService);
  router.use(auth.authenticate, auth.requireAdmin);

  router.get('/', async (request: Request, response: Response) => {
    try {
      const query = listWeeklyDayRecordsQuerySchema.parse(request.query);
      const result = await service.list(query);
      response.json({
        data: result.items,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / query.pageSize),
        },
      });
    } catch (error) {
      handleError(error, response);
    }
  });

  router.get('/:recordId', async (request: Request, response: Response) => {
    try {
      const { recordId } = weeklyDayRecordParamsSchema.parse(request.params);
      response.json({ data: await service.get(recordId) });
    } catch (error) {
      handleError(error, response);
    }
  });

  router.post('/:recordId/convert', async (request: Request, response: Response) => {
    try {
      const { recordId } = weeklyDayRecordParamsSchema.parse(request.params);
      response.json({ data: await service.convert(recordId) });
    } catch (error) {
      handleError(error, response);
    }
  });

  router.post('/:recordId/revert', async (request: Request, response: Response) => {
    try {
      const { recordId } = weeklyDayRecordParamsSchema.parse(request.params);
      response.json({ data: await service.revert(recordId) });
    } catch (error) {
      handleError(error, response);
    }
  });

  return router;
};
