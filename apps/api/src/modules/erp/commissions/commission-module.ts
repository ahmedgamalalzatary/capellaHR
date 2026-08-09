import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type { ErpBranchCapability, ErpEmployeeCapability } from '../hr-capabilities.js';
import { createDrizzleCommissionRepository } from './commission-repository.js';
import { createCommissionService } from './commission-service.js';

export const createCommissionModule = (
  database: ReturnType<typeof createDatabase>,
  capabilities: { branches: ErpBranchCapability; employees: ErpEmployeeCapability },
) => {
  const repository = createDrizzleCommissionRepository(database);
  const service = createCommissionService({
    repository,
    resolveBranchContext: createErpBranchContextResolver(capabilities),
  });
  return { repository, service, selfService: service.selfService };
};
