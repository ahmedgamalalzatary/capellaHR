import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type { ErpAuditCapability, ErpBranchCapability } from '../hr-capabilities.js';
import { createDrizzleFixedAssetRepository } from './fixed-asset-repository.js';
import { createFixedAssetService } from './fixed-asset-service.js';

export const createErpFixedAssetsModule = (
  database: ReturnType<typeof createDatabase>,
  capabilities: { audit: ErpAuditCapability; branches: ErpBranchCapability },
) => {
  const repository = createDrizzleFixedAssetRepository(database, capabilities.audit);
  return {
    repository,
    service: createFixedAssetService({
      repository,
      resolveBranchContext: createErpBranchContextResolver(capabilities),
    }),
  };
};
