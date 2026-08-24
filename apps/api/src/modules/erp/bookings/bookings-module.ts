import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type { ErpAuditCapability, ErpBranchCapability } from '../hr-capabilities.js';
import { createDrizzleBookingRepository } from './booking-repository.js';
import { createBookingService } from './booking-service.js';

export const createErpBookingsModule = (
  database: ReturnType<typeof createDatabase>,
  capabilities: { audit: ErpAuditCapability; branches: ErpBranchCapability },
) => {
  const repository = createDrizzleBookingRepository(database, capabilities.audit);
  return {
    repository,
    conversion: { convert: repository.convert.bind(repository) },
    service: createBookingService({
      repository,
      resolveBranchContext: createErpBranchContextResolver(capabilities),
    }),
  };
};
