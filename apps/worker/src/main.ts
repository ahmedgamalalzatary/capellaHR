import {
  createReportProcessor,
  createReportsModule,
} from '@capella/api/reports-runtime';
import { workerEnv as env } from '@capella/config/worker';
import { createDatabase } from '@capella/database';
import { renderReportPdfToStream } from '@capella/reporting';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';

import { runReportWorker } from './report-worker.js';

const defaultFilesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../api/uploads/reports',
);
const staleAfterMilliseconds = 15 * 60 * 1_000;
const maintenanceIntervalMilliseconds = 5 * 60 * 1_000;
const logger = pino({ level: env.LOG_LEVEL });
const database = createDatabase(env.DATABASE_URL);
const reports = createReportsModule(database, {
  filesRoot: env.REPORT_FILES_ROOT ?? defaultFilesRoot,
  timeZone: env.APP_TIME_ZONE,
});
const processor = createReportProcessor(
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
  const recoverStale = async () => {
    const recoveredAt = new Date();
    const staleBefore = new Date(recoveredAt.valueOf() - staleAfterMilliseconds);
    await reports.repository.recoverStale(
      staleBefore,
      recoveredAt,
    );
    await reports.service.reconcileFiles(staleBefore);
  };
  await recoverStale();
  await runReportWorker(processor, {
    signal: controller.signal,
    idleDelayMs: env.REPORT_WORKER_POLL_MS,
    maintenanceIntervalMs: maintenanceIntervalMilliseconds,
    maintain: recoverStale,
    onIterationError: () => logger.error('Report worker iteration failed'),
  });
} catch {
  logger.fatal('Report worker stopped unexpectedly');
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  await closeDatabase();
}
