import type { createDatabase } from '@capella/database';

import {
  createDrizzleAttendanceRepository,
  type AttendanceFinancialLockCheck,
  type AttendanceRequiredDurationReader,
} from './attendance-repository.js';
import type { AttendanceSessionClosedHook } from './attendance-session-writer.js';
import {
  createAttendanceService,
  type AttendanceFaceGateway,
  type AttendanceDeviceGateway,
} from './attendance-service.js';

export const createAttendanceModule = (
  database: ReturnType<typeof createDatabase>,
  devices: AttendanceDeviceGateway,
  faces: AttendanceFaceGateway,
  options: {
    isFinanciallyLocked?: AttendanceFinancialLockCheck;
    readRequiredDuration: AttendanceRequiredDurationReader;
    afterSessionClosed?: AttendanceSessionClosedHook;
    now?: () => Date;
    timeZone?: string;
  },
) => {
  const resolvedOptions = {
    ...options,
    isFinanciallyLocked: options.isFinanciallyLocked ?? (() => Promise.resolve(false)),
  };
  const repository = createDrizzleAttendanceRepository(database, resolvedOptions);
  return {
    repository,
    service: createAttendanceService(repository, devices, faces, resolvedOptions),
  };
};
