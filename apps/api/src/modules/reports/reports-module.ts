import type { createDatabase } from '@capella/database';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReportFileStore } from './report-file-store.js';
import { createDrizzleReportExportRepository } from './reports-export-repository.js';
import { createDrizzleReportReader } from './reports-reader.js';
import { createReportService } from './reports-service.js';
import type { ReportsPayrollGateway } from './reports-reader.js';

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../uploads/reports',
);

export const createReportsModule = (
  database: ReturnType<typeof createDatabase>,
  options: {
    filesRoot?: string;
    now?: () => Date;
    timeZone?: string;
    payroll?: ReportsPayrollGateway;
  } = {},
) => {
  const reader = createDrizzleReportReader(database, {
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.payroll === undefined ? {} : { payroll: options.payroll }),
  });
  const repository = createDrizzleReportExportRepository(database);
  const fileStore = createReportFileStore(options.filesRoot ?? defaultRoot);
  const service = createReportService(reader, repository, fileStore, options.now);
  return { reader, repository, fileStore, service };
};
