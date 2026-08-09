import {
  createReportProcessor,
  createReportsModule,
  type ReportReader,
  type ReportsPayrollGateway,
} from '@capella/api/reports-runtime';
import { hasModule, type ResolvedEdition } from '@capella/config/edition';
import type { createDatabase } from '@capella/database';
import { renderReportPdfToStream } from '@capella/reporting';

export const createWorkerEditionPlan = (edition: ResolvedEdition) => ({
  attendance: hasModule(edition, 'attendance'),
  payroll: hasModule(edition, 'payroll'),
  reports: hasModule(edition, 'reports'),
  erpReports: hasModule(edition, 'erp-reports'),
});

export const createWorkerReportRuntime = (options: {
  database: ReturnType<typeof createDatabase>;
  erpReader?: ReportReader;
  filesRoot: string;
  timeZone: string;
  payroll?: ReportsPayrollGateway;
}) => {
  const reports = createReportsModule(options.database, {
    filesRoot: options.filesRoot,
    timeZone: options.timeZone,
    ...(options.erpReader ? { erp: options.erpReader } : {}),
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
