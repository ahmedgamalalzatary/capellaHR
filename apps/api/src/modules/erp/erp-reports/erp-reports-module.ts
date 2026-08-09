import type { createDatabase } from '@capella/database';

import { createErpReportReader } from './erp-report-reader.js';
import { createDrizzleErpReportRepository } from './erp-report-repository.js';

export const createErpReportsModule = (database: ReturnType<typeof createDatabase>) => {
  const repository = createDrizzleErpReportRepository(database);
  const reader = createErpReportReader(repository);
  return { repository, reader };
};
