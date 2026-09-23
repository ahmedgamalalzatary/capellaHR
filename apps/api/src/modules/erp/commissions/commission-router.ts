import {
  commissionListQuerySchema,
  commissionMonthParamsSchema,
  commissionPayoutCreateSchema,
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
    const statusByCode: Record<CommissionError['code'], number> = {
      COMMISSION_FORBIDDEN: 403,
      COMMISSION_NOT_FOUND: 404,
      COMMISSION_EMPLOYEE_NOT_FOUND: 404,
      COMMISSION_INSUFFICIENT_AVAILABLE: 409,
      COMMISSION_PAYROLL_FINALIZED: 409,
      COMMISSION_SHIFT_NOT_OPEN: 409,
    };
    const messageByCode: Record<CommissionError['code'], string> = {
      COMMISSION_FORBIDDEN: 'غير مصرح بعرض العمولات',
      COMMISSION_NOT_FOUND: 'سجل العمولة غير موجود',
      COMMISSION_EMPLOYEE_NOT_FOUND: 'الموظف غير موجود',
      COMMISSION_INSUFFICIENT_AVAILABLE: 'المبلغ يتجاوز الرصيد المتاح من العمولة',
      COMMISSION_PAYROLL_FINALIZED: 'لا يمكن صرف عمولة لشهر رواتب مُقفل',
      COMMISSION_SHIFT_NOT_OPEN: 'يجب فتح درج الفرع قبل صرف العمولة',
    };
    errorResponse(response, statusByCode[error.code], error.code, messageByCode[error.code]);
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

  router.post('/:employeeId/:month/payouts', async (request, response, next) => {
    try {
      const params = commissionMonthParamsSchema.parse(request.params);
      const body = commissionPayoutCreateSchema.parse(request.body);
      const data = await service.createPayout(
        actor(response),
        params.employeeId,
        params.month,
        body,
      );
      response.status(201).json({ data });
    } catch (error) { handle(error, response, next); }
  });
  return router;
};
