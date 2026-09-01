import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type { ErpAuditCapability, ErpBranchCapability } from '../hr-capabilities.js';
import { createDrizzleConsumablesRepository } from './consumables-repository.js';
import { createConsumablesService } from './consumables-service.js';

export const createConsumablesModule = (database: ReturnType<typeof createDatabase>, capabilities: {
  audit: ErpAuditCapability;
  branches: ErpBranchCapability;
}) => {
  const repository = createDrizzleConsumablesRepository(database, capabilities.audit);
  return { repository, service: createConsumablesService({ repository, resolveBranchContext: createErpBranchContextResolver(capabilities) }) };
};
