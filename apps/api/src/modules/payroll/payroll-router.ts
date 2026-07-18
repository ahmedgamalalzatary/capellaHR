import {
  listPayrollMonthsQuerySchema,
  payrollBranchMonthParamsSchema,
  payrollEmployeeMonthParamsSchema,
  payrollEmployeeParamsSchema,
  updateBaseSalarySchema,
} from '@capella/contracts';
import { type Request, type Response, Router } from 'express';

import { createAuthMiddleware } from '../auth/auth-middleware.js';
import type { AuthService } from '../auth/auth-service.js';
import { financialFail, handleFinancialValidation } from './financial-http.js';
import { PayrollError, type PayrollService } from './payroll-service.js';

export const createPayrollRouter = (
  service: PayrollService,
  authService: Pick<AuthService, 'authenticate'>,
) => {
  const router = Router();
  const auth = createAuthMiddleware(authService);
  router.use(auth.authenticate, auth.requireAdmin);
  const handle = (error: unknown, response: Response) => {
    if (handleFinancialValidation(error, response)) return;
    if (!(error instanceof PayrollError)) throw error;
    const status = error.code === 'PAYROLL_ATTENDANCE_UNAVAILABLE' ? 503
      : error.code.endsWith('NOT_FOUND') ? 404 : 409;
    financialFail(response, status, error.code, error.message, error.reasons
      ? { details: { blockers: error.reasons } } : {});
  };
  router.get('/', async (request: Request, response: Response) => {
    try {
      const query = listPayrollMonthsQuerySchema.parse(request.query);
      const result = await service.list(query);
      response.json({ data: result.items, meta: {
        page: query.page, pageSize: query.pageSize, total: result.total,
        totalPages: Math.ceil(result.total / query.pageSize),
      } });
    } catch (error) { handle(error, response); }
  });
  router.get('/employees/:employeeId/base-salary', async (request, response) => {
    try { const { employeeId } = payrollEmployeeParamsSchema.parse(request.params); response.json({ data: await service.getBaseSalary(employeeId) }); }
    catch (error) { handle(error, response); }
  });
  router.patch('/employees/:employeeId/base-salary', async (request, response) => {
    try {
      const { employeeId } = payrollEmployeeParamsSchema.parse(request.params);
      response.json({ data: await service.updateBaseSalary(employeeId, updateBaseSalarySchema.parse(request.body)) });
    } catch (error) { handle(error, response); }
  });
  router.get('/employees/:employeeId/months/:month', async (request, response) => {
    try { const { employeeId, month } = payrollEmployeeMonthParamsSchema.parse(request.params); response.json({ data: await service.preview(employeeId, month) }); }
    catch (error) { handle(error, response); }
  });
  router.post('/employees/:employeeId/months/:month/finalize', async (request, response) => {
    try { const { employeeId, month } = payrollEmployeeMonthParamsSchema.parse(request.params); response.json({ data: await service.finalize(employeeId, month) }); }
    catch (error) { handle(error, response); }
  });
  router.post('/branches/:branchId/months/:month/finalize', async (request, response) => {
    try { const { branchId, month } = payrollBranchMonthParamsSchema.parse(request.params); response.json({ data: await service.finalizeBranch(branchId, month) }); }
    catch (error) { handle(error, response); }
  });
  return router;
};
