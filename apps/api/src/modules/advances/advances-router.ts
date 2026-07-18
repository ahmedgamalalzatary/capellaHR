import {
  advanceParamsSchema,
  createAdvanceSchema,
  listAdvancesQuerySchema,
  updateAdvanceSchema,
} from '@capella/contracts';
import type { Response } from 'express';

import type { AuthService } from '../auth/index.js';
import { createFinancialCrudRouter, financialFail } from '../payroll/financial-http.js';
import { AdvanceError, type AdvanceService } from './advances-service.js';

export const createAdvancesRouter = (
  service: AdvanceService,
  auth: Pick<AuthService, 'authenticate'>,
) => createFinancialCrudRouter(service, auth, {
  create: createAdvanceSchema,
  update: updateAdvanceSchema,
  query: listAdvancesQuerySchema,
  params: advanceParamsSchema,
  recordPath: '/:advanceId',
  id: ({ advanceId }) => advanceId,
}, (error, response: Response) => {
  if (!(error instanceof AdvanceError)) return false;
  const status = error.code.endsWith('NOT_FOUND') ? 404
    : error.code === 'ADVANCE_INVALID_SCHEDULE' ? 400 : 409;
  financialFail(response, status, error.code, error.message);
  return true;
});
