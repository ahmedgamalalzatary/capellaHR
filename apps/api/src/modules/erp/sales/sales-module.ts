import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type {
  ErpAuditCapability,
  ErpBranchCapability,
  ErpEmployeeCapability,
} from '../hr-capabilities.js';
import { createDrizzleCashierSessionRepository } from './cashier-sessions-repository.js';
import { createCashierSessionService } from './cashier-sessions-service.js';

export const createSalesModule = (
  database: ReturnType<typeof createDatabase>,
  capabilities: {
    audit: ErpAuditCapability;
    branches: ErpBranchCapability;
    employees: ErpEmployeeCapability;
  },
) => {
  const cashierSessionRepository = createDrizzleCashierSessionRepository(
    database,
    capabilities.audit,
  );
  const cashierSessions = createCashierSessionService({
    repository: cashierSessionRepository,
    resolveBranchContext: createErpBranchContextResolver(capabilities),
  });
  return { cashierSessionRepository, cashierSessions };
};
