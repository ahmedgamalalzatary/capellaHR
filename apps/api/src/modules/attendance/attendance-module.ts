import type { createDatabase } from '@capella/database';

import {
  createDrizzleAttendanceRepository,
  type AttendanceFinancialLockCheck,
  type AttendanceRequiredDurationReader,
} from './attendance-repository.js';
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
    isFinanciallyLocked: AttendanceFinancialLockCheck;
    readRequiredDuration: AttendanceRequiredDurationReader;
    now?: () => Date;
    timeZone?: string;
  },
) => {
  const repository = createDrizzleAttendanceRepository(database, options);
  return {
    repository,
    service: createAttendanceService(repository, devices, faces, options),
  };
};
