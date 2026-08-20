import {
  cashierSessionCurrentQuerySchema,
  cashierSessionListQuerySchema,
  cashierSessionParamsSchema,
  recoveryCloseCashierSessionSchema,
} from '@capella/contracts';
import { Router, type NextFunction, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { ErpBranchContextError } from '../branch-context.js';
import {
  CashierSessionError,
  type CashierSessionService,
} from './cashier-sessions-service.js';

const failure = (
  response: Response,
  status: number,
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>,
) => {
  response.status(status).json({
    error: {
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
      requestId: responseRequestId(response),
    },
  });
};

const actorFrom = (response: Response): ErpAccountIdentity => {
  const actor = response.locals.actor as {
    type?: string;
    accountId?: number;
    branchId?: number;
  } | undefined;
  if (actor?.type === 'admin' && actor.accountId) {
    return { role: 'admin', accountId: actor.accountId };
  }
  if (actor?.type === 'cashier' && actor.accountId && actor.branchId) {
    return {
      role: 'cashier',
      accountId: actor.accountId,
      branchId: actor.branchId,
    };
  }
  throw new CashierSessionError(
    'ERP_CASHIER_SESSION_ADMIN_REQUIRED',
    'حساب نقطة بيع صالح مطلوب',
  );
};

const handleError = (error: unknown, response: Response, next: NextFunction) => {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = issue.path.join('.') || '_root';
      (fieldErrors[field] ??= []).push(issue.message);
    }
    failure(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', fieldErrors);
    return;
  }
  if (error instanceof ErpBranchContextError) {
    const status = error.code === 'ERP_BRANCH_REQUIRED'
      ? 400
      : error.code === 'ERP_BRANCH_NOT_FOUND'
        ? 404
        : 403;
    failure(response, status, error.code, error.message);
    return;
  }
  if (error instanceof CashierSessionError) {
    const status = error.code === 'ERP_CASHIER_SESSION_NOT_FOUND'
      ? 404
      : error.code === 'ERP_CASHIER_SESSION_CASHIER_REQUIRED'
        || error.code === 'ERP_CASHIER_SESSION_ADMIN_REQUIRED'
        || error.code === 'ERP_CASHIER_SESSION_NOT_OWNER'
        ? 403
        : error.code === 'ERP_CASHIER_SESSION_INVALID_RECOVERY_REASON'
          ? 400
        : 409;
    failure(response, status, error.code, error.message);
    return;
  }
  next(error);
};

export const createCashierSessionsRouter = (service: CashierSessionService) => {
  const router = Router();

  router.post('/open', async (_request, response, next) => {
    try {
      response.status(201).json({ data: await service.open(actorFrom(response)) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/', async (request, response, next) => {
    try {
      const query = cashierSessionListQuerySchema.parse(request.query);
      const result = await service.list(actorFrom(response), query);
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
      handleError(error, response, next);
    }
  });

  router.get('/current', async (request, response, next) => {
    try {
      const query = cashierSessionCurrentQuerySchema.parse(request.query);
      response.json({ data: await service.current(actorFrom(response), query.branchId) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/close', async (_request, response, next) => {
    try {
      response.json({ data: await service.close(actorFrom(response)) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/:sessionId', async (request, response, next) => {
    try {
      const { sessionId } = cashierSessionParamsSchema.parse(request.params);
      response.json({ data: await service.summary(actorFrom(response), sessionId) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/:sessionId/invoices', async (request, response, next) => {
    try {
      const { sessionId } = cashierSessionParamsSchema.parse(request.params);
      response.json({ data: await service.detail(actorFrom(response), sessionId) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/:sessionId/recovery-close', async (request, response, next) => {
    try {
      const actor = actorFrom(response);
      if (actor.role !== 'admin') {
        throw new CashierSessionError(
          'ERP_CASHIER_SESSION_ADMIN_REQUIRED',
          'الإغلاق الاستثنائي متاح للمسؤول فقط',
        );
      }
      const { sessionId } = cashierSessionParamsSchema.parse(request.params);
      const { reason } = recoveryCloseCashierSessionSchema.parse(request.body);
      response.json({
        data: await service.recoveryClose(actor, sessionId, reason),
      });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  return router;
};
