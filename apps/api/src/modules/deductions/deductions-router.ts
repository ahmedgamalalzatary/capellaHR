import {
  createDeductionSchema,
  deductionParamsSchema,
  listDeductionsQuerySchema,
  updateDeductionSchema,
} from '@capella/contracts';
import type { Response } from 'express';

import type { AuthService } from '../auth/index.js';
import { createFinancialCrudRouter, financialFail } from '../payroll/financial-http.js';
import { FinancialAdjustmentError } from '../payroll/financial-adjustment-service.js';
import type { DeductionService } from './deductions-service.js';

export const createDeductionsRouter = (
  service: DeductionService,
  auth: Pick<AuthService, 'authenticate'>,
) => createFinancialCrudRouter(service, auth, {
  create: createDeductionSchema,
  update: updateDeductionSchema,
  query: listDeductionsQuerySchema,
  params: deductionParamsSchema,
  recordPath: '/:deductionId',
  id: ({ deductionId }) => deductionId,
}, (error, response: Response) => {
  if (!(error instanceof FinancialAdjustmentError) || !error.code.startsWith('DEDUCTION_')) return false;
  const status = error.code.endsWith('NOT_FOUND') ? 404 : 409;
  financialFail(response, status, error.code, error.message);
  return true;
});
