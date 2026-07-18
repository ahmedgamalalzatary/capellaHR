import type { CreateDeductionInput, ListDeductionsQuery, UpdateDeductionInput } from '@capella/contracts';

import {
  createAdjustmentService,
  type AdjustmentRepository,
  type FinancialAdjustmentRecord,
} from '../payroll/financial-adjustment-service.js';

export type DeductionRecord = FinancialAdjustmentRecord;
export type DeductionRepository = AdjustmentRepository<
  CreateDeductionInput, UpdateDeductionInput, ListDeductionsQuery, DeductionRecord
>;
export const createDeductionService = (repository: DeductionRepository) => (
  createAdjustmentService(repository, 'DEDUCTION')
);
export type DeductionService = ReturnType<typeof createDeductionService>;
