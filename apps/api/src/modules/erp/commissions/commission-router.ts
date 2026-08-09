import {
  commissionListQuerySchema,
  commissionMonthParamsSchema,
} from '@capella/contracts';
import { Router, type NextFunction, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import { CommissionError, type CommissionService } from './commission-service.js';

const errorResponse = (response: Response, status: number, code: string, message: string) => (
  response.status(status).json({ error: { code, message, requestId: responseRequestId(response) } })
);
const handle = (error: unknown, response: Response, next: NextFunction) => {
  if (error instanceof ZodError) {
    errorResponse(response, 400, 'COMMISSION_VALIDATION_FAILED', 'بيانات العمولة غير صالحة');
    return;
  }
  if (error instanceof CommissionError) {
    errorResponse(
      response,
      error.code === 'COMMISSION_FORBIDDEN' ? 403 : 404,
      error.code,
      error.code === 'COMMISSION_FORBIDDEN' ? 'غير مصرح بعرض العمولات' : 'سجل العمولة غير موجود',
    );
    return;
  }
  if (error instanceof ErpBranchContextError) {
    errorResponse(response, error.code === 'ERP_BRANCH_NOT_FOUND' ? 404 : 403, error.code, error.message);
    return;
  }
  next(error);
};

export const createCommissionRouter = (service: CommissionService) => {
  const router = Router();
  const actor = (response: Response) => {
    const identity = erpActorFromLocals(response.locals.actor);
    if (!identity) throw new CommissionError('COMMISSION_FORBIDDEN');
    return identity;
  };

  router.get('/', async (request, response, next) => {
    try {
      const query = commissionListQuerySchema.parse(request.query);
      const result = await service.list(actor(response), query);
      response.json({
        data: result.items,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / query.pageSize),
        },
      });
    } catch (error) { handle(error, response, next); }
  });

  router.get('/:employeeId/:month', async (request, response, next) => {
    try {
      const params = commissionMonthParamsSchema.parse(request.params);
      const { branchId } = commissionListQuerySchema.pick({ branchId: true }).parse(request.query);
      response.json({
        data: await service.detail(
          actor(response),
          params.employeeId,
          params.month,
          branchId,
        ),
      });
    } catch (error) { handle(error, response, next); }
  });
  return router;
};
