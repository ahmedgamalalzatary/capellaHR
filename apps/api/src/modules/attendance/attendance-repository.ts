import type { PayrollAttendanceGateway } from '../payroll/index.js';
import { createAttendanceDeniedRepository } from './attendance-denied-repository.js';
import { createAttendanceJobsRepository } from './attendance-jobs-repository.js';
import { createAttendancePayrollGateway } from './attendance-payroll-gateway.js';
import {
  type AttendanceFinancialLockCheck,
  type AttendanceRequiredDurationReader,
  type AttendanceShiftChangeReconciler,
  type Database,
} from './attendance-repository-support.js';
import { createAttendanceSessionWriter, type AttendanceSessionClosedHook } from './attendance-session-writer.js';
import { createAttendanceSessionsRepository } from './attendance-sessions-repository.js';
import type { AttendanceRepository } from './attendance-service.js';
import type { AttendanceJobRepository } from './attendance-jobs.js';

export type {
  AttendanceFinancialLockCheck,
  AttendanceRequiredDurationReader,
  AttendanceShiftChangeReconciler,
} from './attendance-repository-support.js';

export const createDrizzleAttendanceRepository = (
  database: Database,
  options: {
    now?: () => Date;
    timeZone?: string;
    isFinanciallyLocked: AttendanceFinancialLockCheck;
    readRequiredDuration: AttendanceRequiredDurationReader;
    afterSessionClosed?: AttendanceSessionClosedHook;
  },
): AttendanceRepository & AttendanceJobRepository & {
  reconcileDueAbsencesForEmployee: AttendanceShiftChangeReconciler;
} & PayrollAttendanceGateway => {
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone ?? 'Africa/Cairo';
  const { isFinanciallyLocked, readRequiredDuration } = options;
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(0));

  const writer = createAttendanceSessionWriter({
    now,
    timeZone,
    isFinanciallyLocked,
    readRequiredDuration,
    ...(options.afterSessionClosed === undefined
      ? {}
      : { afterSessionClosed: options.afterSessionClosed }),
  });

  return {
    ...createAttendanceSessionsRepository(database, writer, { now, isFinanciallyLocked }),
    ...createAttendanceDeniedRepository(database, writer, { now, timeZone }),
    ...createAttendanceJobsRepository(database, writer, { now, timeZone }),
    ...createAttendancePayrollGateway({ now, timeZone }),
  };
};
