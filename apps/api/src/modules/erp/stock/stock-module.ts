import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type { ErpAuditCapability, ErpBranchCapability, ErpEmployeeCapability } from '../hr-capabilities.js';
import type { SyncCopyRunner } from '../product-sync/product-copy-contract.js';
import { createDrizzleProductStockRepository } from './product-stock-repository.js';
import { createProductStockService } from './product-stock-service.js';

export const createErpStockModule = (database: ReturnType<typeof createDatabase>, capabilities: {
  audit: ErpAuditCapability; branches: ErpBranchCapability; employees: ErpEmployeeCapability;
  /** Present only when product sync is part of this edition. */
  syncCopy?: SyncCopyRunner;
}) => {
  const repository = createDrizzleProductStockRepository(
    database, capabilities.audit, undefined, capabilities.syncCopy,
  );
  return { repository, service: createProductStockService({ repository, resolveBranchContext: createErpBranchContextResolver(capabilities) }) };
};
