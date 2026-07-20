import type { createDatabase } from '@capella/database';

import { createDrizzleAuditRepository } from './audit-repository.js';
import { createAuditService } from './audit-service.js';

type Database = ReturnType<typeof createDatabase>;

export const createAuditModule = (database: Database, options: { timeZone?: string } = {}) => {
  const repository = createDrizzleAuditRepository(database, options);
  return { repository, service: createAuditService(repository) };
};
