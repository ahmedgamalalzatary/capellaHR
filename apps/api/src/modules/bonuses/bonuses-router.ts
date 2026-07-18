import {
  bonusParamsSchema,
  createBonusSchema,
  listBonusesQuerySchema,
  updateBonusSchema,
} from '@capella/contracts';
import type { Response } from 'express';

import type { AuthService } from '../auth/index.js';
import { createFinancialCrudRouter, financialFail } from '../payroll/financial-http.js';
import { FinancialAdjustmentError } from '../payroll/financial-adjustment-service.js';
import type { BonusService } from './bonuses-service.js';

export const createBonusesRouter = (
  service: BonusService,
  auth: Pick<AuthService, 'authenticate'>,
) => createFinancialCrudRouter(service, auth, {
  create: createBonusSchema,
  update: updateBonusSchema,
  query: listBonusesQuerySchema,
  params: bonusParamsSchema,
  recordPath: '/:bonusId',
  id: ({ bonusId }) => bonusId,
}, (error, response: Response) => {
  if (!(error instanceof FinancialAdjustmentError) || !error.code.startsWith('BONUS_')) return false;
  const status = error.code.endsWith('NOT_FOUND') ? 404 : 409;
  financialFail(response, status, error.code, error.message);
  return true;
});
