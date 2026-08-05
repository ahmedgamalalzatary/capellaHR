import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type { ErpAuditCapability, ErpBranchCapability, ErpEmployeeCapability } from '../hr-capabilities.js';
import { createDrizzleExpenseRepository } from './expense-repository.js';
import { createExpenseService } from './expense-service.js';

export const createErpExpensesModule = (database: ReturnType<typeof createDatabase>, capabilities: { audit: ErpAuditCapability; branches: ErpBranchCapability; employees: ErpEmployeeCapability }) => {
  const repository = createDrizzleExpenseRepository(database, capabilities.audit);
  return { repository, service: createExpenseService({ repository, resolveBranchContext: createErpBranchContextResolver(capabilities) }) };
};
