import type { createDatabase } from '@capella/database';

import { createDrizzleAuditRepository } from './audit-repository.js';
import { createAuditService } from './audit-service.js';
import { createErpAuditCapability } from './erp-audit-capability.js';

type Database = ReturnType<typeof createDatabase>;

export const createAuditModule = (database: Database, options: { timeZone?: string } = {}) => {
  const repository = createDrizzleAuditRepository(database, options);
  return {
    repository,
    service: createAuditService(repository),
    erp: createErpAuditCapability(),
  };
};
