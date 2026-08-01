import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type {
  ErpAuditCapability,
  ErpBranchCapability,
  ErpEmployeeCapability,
} from '../hr-capabilities.js';
import { createDrizzleClientRepository } from './clients-repository.js';
import { createClientService } from './clients-service.js';

export const createErpClientsModule = (
  database: ReturnType<typeof createDatabase>,
  capabilities: {
    audit: ErpAuditCapability;
    branches: ErpBranchCapability;
    employees: ErpEmployeeCapability;
  },
) => {
  const repository = createDrizzleClientRepository(database, capabilities.audit);
  return {
    repository,
    service: createClientService({
      repository,
      resolveBranchContext: createErpBranchContextResolver(capabilities),
    }),
  };
};
