import type { createDatabase } from '@capella/database';

import { createDrizzleBranchRepository } from './branches-repository.js';
import { createBranchService } from './branches-service.js';
import { createErpBranchCapability } from './erp-branch-capability.js';

export const createBranchesModule = (database: ReturnType<typeof createDatabase>) => {
  const repository = createDrizzleBranchRepository(database);
  return {
    repository,
    service: createBranchService(repository),
    erp: createErpBranchCapability(repository),
  };
};
