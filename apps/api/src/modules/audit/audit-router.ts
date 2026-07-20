import { listAuditEventsQuerySchema } from '@capella/contracts';
import { Router, type NextFunction, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../shared/http/index.js';
import { createAuthMiddleware } from '../auth/auth-middleware.js';
import type { AuthService } from '../auth/auth-service.js';
import type { AuditService } from './audit-service.js';

const handle = (error: unknown, response: Response, next: NextFunction) => {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = issue.path.join('.') || '_root';
      (fieldErrors[field] ??= []).push(issue.message);
    }
    response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'بيانات الطلب غير صالحة',
        fieldErrors,
        requestId: responseRequestId(response),
      },
    });
    return;
  }
  next(error);
};

export const createAuditRouter = (
  service: AuditService,
  authService: Pick<AuthService, 'authenticate'>,
) => {
  const router = Router();
  const auth = createAuthMiddleware(authService);
  router.use(auth.authenticate, auth.requireAdmin);
  router.get('/', async (request, response, next) => {
    try {
      const query = listAuditEventsQuerySchema.parse(request.query);
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
      handle(error, response, next);
    }
  });
  return router;
};
