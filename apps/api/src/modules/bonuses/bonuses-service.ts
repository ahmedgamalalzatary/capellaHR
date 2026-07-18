import type { CreateBonusInput, ListBonusesQuery, UpdateBonusInput } from '@capella/contracts';

import {
  createAdjustmentService,
  type AdjustmentRepository,
  type FinancialAdjustmentRecord,
} from '../payroll/financial-adjustment-service.js';

export type BonusRecord = FinancialAdjustmentRecord;
export type BonusRepository = AdjustmentRepository<
  CreateBonusInput, UpdateBonusInput, ListBonusesQuery, BonusRecord
>;
export const createBonusService = (repository: BonusRepository) => (
  createAdjustmentService(repository, 'BONUS')
);
export type BonusService = ReturnType<typeof createBonusService>;
