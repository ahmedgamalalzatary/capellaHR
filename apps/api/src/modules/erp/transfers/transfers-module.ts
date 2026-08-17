import type { createDatabase } from '@capella/database';

import type { ErpAuditCapability, ErpBranchCapability } from '../hr-capabilities.js';
import { createDrizzleStockTransferRepository } from './stock-transfer-repository.js';
import { createStockTransferService } from './stock-transfer-service.js';

export const createErpTransfersModule = (
  database: ReturnType<typeof createDatabase>,
  capabilities: {
    audit: ErpAuditCapability;
    branches: ErpBranchCapability;
    sales: Parameters<typeof createStockTransferService>[0]['sales'];
  },
) => {
  const repository = createDrizzleStockTransferRepository(database, capabilities.audit);
  return {
    repository,
    service: createStockTransferService({
      repository,
      sales: capabilities.sales,
      branches: capabilities.branches,
    }),
  };
};
