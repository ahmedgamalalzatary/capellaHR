import {
  createReportProcessor,
  createReportsModule,
  type ReportReader,
  type ReportsPayrollGateway,
} from '@capella/api/reports-runtime';
import type { createDatabase } from '@capella/database';
import { renderReportPdfToStream } from '@capella/reporting';

export const createWorkerReportRuntime = (options: {
  database: ReturnType<typeof createDatabase>;
  erpReader: ReportReader;
  filesRoot: string;
  timeZone: string;
  payroll?: ReportsPayrollGateway;
}) => {
  const reports = createReportsModule(options.database, {
    filesRoot: options.filesRoot,
    timeZone: options.timeZone,
    erp: options.erpReader,
    ...(options.payroll ? { payroll: options.payroll } : {}),
  });
  const reportProcessor = createReportProcessor(
    reports.reader,
    reports.repository,
    reports.fileStore,
    renderReportPdfToStream,
  );
  return { reports, reportProcessor };
};
