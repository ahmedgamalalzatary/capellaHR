import { type createDatabase } from '@capella/database';

import { createDrizzleDeductionRepository } from './deductions-repository.js';
import { createDeductionService } from './deductions-service.js';

export const createDeductionModule = (
  database: ReturnType<typeof createDatabase>,
  options: { now?: () => Date; timeZone?: string } = {},
) => {
  const repository = createDrizzleDeductionRepository(database, options);
  return { repository, service: createDeductionService(repository) };
};
