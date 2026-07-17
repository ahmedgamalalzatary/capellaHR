import {
  listShiftAssignmentsQuerySchema,
  shiftEmployeeParamsSchema,
  updateShiftAssignmentSchema,
} from '@capella/contracts';
import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../shared/http/index.js';
import { createAuthMiddleware } from '../auth/auth-middleware.js';
import type { AuthService } from '../auth/auth-service.js';
import { ShiftError, type ShiftService } from './shifts-service.js';

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
  if (error instanceof ShiftError) {
    fail(response, 404, error.code, error.message);
    return;
  }
  throw error;
};

export const createShiftsRouter = (
  service: ShiftService,
  authService: Pick<AuthService, 'authenticate'>,
) => {
  const router = Router();
  const auth = createAuthMiddleware(authService);
  router.use(auth.authenticate, auth.requireAdmin);

  router.get('/', async (request: Request, response: Response) => {
    try {
      const query = listShiftAssignmentsQuerySchema.parse(request.query);
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

  router.get('/employees/:employeeId', async (request: Request, response: Response) => {
    try {
      const { employeeId } = shiftEmployeeParamsSchema.parse(request.params);
      response.json({ data: await service.getByEmployee(employeeId) });
    } catch (error) {
      handleError(error, response);
    }
  });

  router.patch('/employees/:employeeId', async (request: Request, response: Response) => {
    try {
      const { employeeId } = shiftEmployeeParamsSchema.parse(request.params);
      const input = updateShiftAssignmentSchema.parse(request.body);
      response.json({ data: await service.updateByEmployee(employeeId, input) });
    } catch (error) {
      handleError(error, response);
    }
  });

  return router;
};
