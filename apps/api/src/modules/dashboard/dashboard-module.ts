import type { createDatabase } from '@capella/database';

import { createDrizzleDashboardRepository } from './dashboard-repository.js';
import { createDashboardService } from './dashboard-service.js';

export const createDashboardModule = (
  database: ReturnType<typeof createDatabase>,
  options: {
    now?: () => Date;
    timeZone?: string;
  },
) => {
  const repository = createDrizzleDashboardRepository(database, options);
  return { repository, service: createDashboardService(repository) };
};
