import type { createDatabase } from '@capella/database';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import { createDrizzleProductSyncRepository } from './product-sync-repository.js';
import { createProductSyncService } from './product-sync-service.js';

export const createErpProductSyncModule = (
  database: ReturnType<typeof createDatabase>,
  capabilities: {
    audit: ErpAuditCapability;
    /** Built before the stock module so its create can call `copyOnCreate`. */
    repository?: ReturnType<typeof createDrizzleProductSyncRepository>;
  },
) => {
  const repository = capabilities.repository ?? createDrizzleProductSyncRepository(database, capabilities.audit);
  return {
    repository,
    service: createProductSyncService({ repository }),
  };
};
