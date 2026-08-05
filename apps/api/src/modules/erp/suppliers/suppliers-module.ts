import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type { ErpAuditCapability, ErpBranchCapability, ErpEmployeeCapability } from '../hr-capabilities.js';
import { createDrizzleSupplierPurchaseRepository } from './suppliers-repository.js';
import { createSupplierPurchaseService } from './suppliers-service.js';

export const createErpSuppliersModule = (database: ReturnType<typeof createDatabase>, capabilities: { audit: ErpAuditCapability; branches: ErpBranchCapability; employees: ErpEmployeeCapability }) => {
  const repository = createDrizzleSupplierPurchaseRepository(database, capabilities.audit);
  return { repository, service: createSupplierPurchaseService({ repository, resolveBranchContext: createErpBranchContextResolver(capabilities) }) };
};
