import type { createDatabase } from '@capella/database';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import { createDrizzleProductSyncRepository } from './product-sync-repository.js';
import { createProductSyncService } from './product-sync-service.js';

export const createErpProductSyncModule = (
  database: ReturnType<typeof createDatabase>,
  capabilities: { audit: ErpAuditCapability },
) => {
  const repository = createDrizzleProductSyncRepository(database, capabilities.audit);
  return {
    repository,
    service: createProductSyncService({ repository }),
  };
};
