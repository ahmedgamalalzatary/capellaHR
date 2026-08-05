import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type { ErpAuditCapability, ErpBranchCapability, ErpEmployeeCapability } from '../hr-capabilities.js';
import { createDrizzleProductStockRepository } from './product-stock-repository.js';
import { createProductStockService } from './product-stock-service.js';

export const createErpStockModule = (database: ReturnType<typeof createDatabase>, capabilities: {
  audit: ErpAuditCapability; branches: ErpBranchCapability; employees: ErpEmployeeCapability;
}) => {
  const repository = createDrizzleProductStockRepository(database, capabilities.audit);
  return { repository, service: createProductStockService({ repository, resolveBranchContext: createErpBranchContextResolver(capabilities) }) };
};
