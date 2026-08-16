import {
  branchCashierRosterQuerySchema,
  replaceBranchCashierRosterSchema,
} from '@capella/contracts';
import { Router, type NextFunction, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import {
  BranchCashierRosterError,
  type BranchCashierRosterService,
} from './branch-cashier-roster-service.js';

const failure = (
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
    return { role: 'cashier', accountId: actor.accountId, branchId: actor.branchId };
  }
  throw new BranchCashierRosterError(
    'ERP_ROSTER_ADMIN_REQUIRED',
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
  if (error instanceof BranchCashierRosterError) {
    const status = error.code === 'ERP_ROSTER_ADMIN_REQUIRED' ? 403 : 409;
    failure(response, status, error.code, error.message);
    return;
  }
  next(error);
};

export const createBranchCashierRosterRouter = (service: BranchCashierRosterService) => {
  const router = Router();

  router.get('/', async (request, response, next) => {
    try {
      const query = branchCashierRosterQuerySchema.parse(request.query);
      response.json({ data: await service.list(actorFrom(response), query) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.put('/', async (request, response, next) => {
    try {
      const actor = actorFrom(response);
      if (actor.role !== 'admin') {
        throw new BranchCashierRosterError(
          'ERP_ROSTER_ADMIN_REQUIRED',
          'تعديل وردية الفرع متاح للمسؤول فقط',
        );
      }
      const query = branchCashierRosterQuerySchema.parse(request.query);
      const input = replaceBranchCashierRosterSchema.parse(request.body);
      response.json({
        data: await service.replace(actor, query, input),
      });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  return router;
};
