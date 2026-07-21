import {
  createReportProcessor,
  createReportsModule,
} from '@capella/api/reports-runtime';
import { createAttendanceJobsRuntime } from '@capella/api/attendance-runtime';
import { workerEnv as env } from '@capella/config/worker';
import { createDatabase } from '@capella/database';
import { renderReportPdfToStream } from '@capella/reporting';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';

import { scheduleCurrentAttendanceDate } from './attendance-scheduler.js';
import { runIndependentWorkers } from './report-worker.js';

const defaultFilesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../api/uploads/reports',
);
const staleAfterMilliseconds = 15 * 60 * 1_000;
const maintenanceIntervalMilliseconds = 5 * 60 * 1_000;
const logger = pino({ level: env.LOG_LEVEL });
const database = createDatabase(env.DATABASE_URL);
const attendance = createAttendanceJobsRuntime(database, {
  timeZone: env.APP_TIME_ZONE,
});
const reports = createReportsModule(database, {
  filesRoot: env.REPORT_FILES_ROOT ?? defaultFilesRoot,
  timeZone: env.APP_TIME_ZONE,
  payroll: {
    preview: (employeeId, month, context) => (
      attendance.payroll.repository.previewInContext(
        employeeId,
        month,
        attendance.repository,
        context,
      )
    ),
  },
});
const reportProcessor = createReportProcessor(
  reports.reader,
  reports.repository,
  reports.fileStore,
  renderReportPdfToStream,
);
const controller = new AbortController();
const stop = () => controller.abort();
const closeDatabase = () => new Promise<void>((resolve, reject) => {
  database.$client.end((error) => {
    if (error) reject(error);
    else resolve();
  });
});
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  const maintainAttendance = async () => {
    const recoveredAt = new Date();
    const staleBefore = new Date(recoveredAt.valueOf() - staleAfterMilliseconds);
    await scheduleCurrentAttendanceDate(
      attendance.repository,
      recoveredAt,
      env.APP_TIME_ZONE,
    );
    await attendance.repository.reconcileFailed();
    await attendance.repository.recoverStale(staleBefore);
  };
  const maintainReports = async () => {
    const recoveredAt = new Date();
    const staleBefore = new Date(recoveredAt.valueOf() - staleAfterMilliseconds);
    await reports.repository.recoverStale(
      staleBefore,
      recoveredAt,
    );
    await reports.service.reconcileFiles(staleBefore);
  };
  await Promise.all([maintainAttendance(), maintainReports()]);
  await runIndependentWorkers(attendance.processor, reportProcessor, {
    signal: controller.signal,
    idleDelayMs: env.REPORT_WORKER_POLL_MS,
    maintenanceIntervalMs: maintenanceIntervalMilliseconds,
    maintain: maintainAttendance,
    reportMaintain: maintainReports,
    onIterationError: () => logger.error('Background worker iteration failed'),
  });
} catch {
  logger.fatal('Background worker stopped unexpectedly');
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  await closeDatabase();
}
