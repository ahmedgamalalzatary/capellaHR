import {
  selfServiceFinancialListQuerySchema,
  selfServicePayrollMonthParamsSchema,
  selfServiceWeeklyDayListQuerySchema,
} from '@capella/contracts';
import { type NextFunction, type Request, type Response, Router } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../shared/http/index.js';
import { createAuthMiddleware } from '../auth/index.js';
import type { AuthService } from '../auth/index.js';
import { PayrollError } from '../payroll/index.js';
import type { SelfServiceService } from './self-service-service.js';

const employeeId = (response: Response) => {
  const actor = response.locals.actor as { type?: string; employeeId?: number } | undefined;
  if (actor?.type !== 'employee' || actor.employeeId === undefined) {
    throw new Error('Employee authorization invariant violated');
  }
  return actor.employeeId;
};

const sendPage = <T>(
  response: Response,
  result: { items: T[]; total: number },
  query: { page: number; pageSize: number },
) => response.json({
  data: result.items,
  meta: {
    page: query.page,
    pageSize: query.pageSize,
    total: result.total,
    totalPages: Math.ceil(result.total / query.pageSize),
  },
});

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
  if (error instanceof PayrollError) {
    const status = error.code === 'PAYROLL_ATTENDANCE_UNAVAILABLE' ? 503
      : error.code.endsWith('NOT_FOUND') ? 404 : 409;
    response.status(status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.reasons ? { details: { blockers: error.reasons } } : {}),
        requestId: responseRequestId(response),
      },
    });
    return;
  }
  next(error);
};

export const createSelfServiceRouter = (
  service: SelfServiceService,
  authService: Pick<AuthService, 'authenticate'>,
) => {
  const router = Router();
  const auth = createAuthMiddleware(authService);
  router.use(auth.authenticate, auth.requireEmployee);

  router.get('/overview', async (_request: Request, response: Response, next: NextFunction) => {
    try { response.json({ data: await service.getOverview(employeeId(response)) }); }
    catch (error) { handle(error, response, next); }
  });

  router.get('/weekly-days', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = selfServiceWeeklyDayListQuerySchema.parse(request.query);
      sendPage(response, await service.listWeeklyDays(employeeId(response), query), query);
    } catch (error) { handle(error, response, next); }
  });

  router.get('/payroll/:month', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { month } = selfServicePayrollMonthParamsSchema.parse(request.params);
      response.json({ data: await service.getPayrollMonth(employeeId(response), month) });
    } catch (error) { handle(error, response, next); }
  });

  const financialList = (
    read: (id: number, query: ReturnType<typeof selfServiceFinancialListQuerySchema.parse>) => Promise<{ items: unknown[]; total: number }>,
  ) => async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = selfServiceFinancialListQuerySchema.parse(request.query);
      sendPage(response, await read(employeeId(response), query), query);
    } catch (error) { handle(error, response, next); }
  };

  router.get('/bonuses', financialList((id, query) => service.listBonuses(id, query)));
  router.get('/deductions', financialList((id, query) => service.listDeductions(id, query)));
  router.get('/advances', financialList((id, query) => service.listAdvances(id, query)));

  return router;
};
