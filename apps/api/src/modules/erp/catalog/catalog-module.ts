import type { createDatabase } from '@capella/database';

import { createErpBranchContextResolver } from '../branch-context.js';
import type {
  ErpAuditCapability,
  ErpBranchCapability,
  ErpEmployeeCapability,
} from '../hr-capabilities.js';
import { createDrizzleCategoryRepository } from './categories-repository.js';
import { createCategoryService } from './categories-service.js';
import { createDrizzleServiceRepository } from './services-repository.js';
import { createServiceCatalogService } from './services-service.js';

export const createErpCatalogModule = (
  database: ReturnType<typeof createDatabase>,
  capabilities: {
    audit: ErpAuditCapability;
    branches: ErpBranchCapability;
    employees: ErpEmployeeCapability;
  },
) => {
  const categoryRepository = createDrizzleCategoryRepository(database, capabilities.audit);
  const serviceRepository = createDrizzleServiceRepository(database, capabilities.audit);
  const resolveBranchContext = createErpBranchContextResolver(capabilities);

  return {
    categoryRepository,
    serviceRepository,
    categories: createCategoryService({ repository: categoryRepository, resolveBranchContext }),
    services: createServiceCatalogService({
      repository: serviceRepository,
      categories: categoryRepository,
      employees: capabilities.employees,
      resolveBranchContext,
    }),
  };
};
