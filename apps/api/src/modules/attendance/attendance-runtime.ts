import type { createDatabase } from '@capella/database';

import { createPayrollModule } from '../payroll/payroll-module.js';
import { createShiftsModule } from '../shifts/shifts-module.js';
import { createAttendanceJobProcessor } from './attendance-jobs.js';
import {
  createDrizzleAttendanceRepository,
  type AttendanceShiftChangeReconciler,
} from './attendance-repository.js';

export const createAttendanceJobsRuntime = (
  database: ReturnType<typeof createDatabase>,
  options: { now?: () => Date; timeZone?: string } = {},
) => {
  let isFinanciallyLocked: Parameters<typeof createDrizzleAttendanceRepository>[1]['isFinanciallyLocked'] = (
    () => Promise.resolve(false)
  );
  let reconcileAbsencesBeforeShiftChange: AttendanceShiftChangeReconciler = () => Promise.resolve(0);
  const shifts = createShiftsModule(database, {
    beforeDurationChange: (employeeId, previousDurationMinutes, context) => (
      reconcileAbsencesBeforeShiftChange(
        employeeId,
        previousDurationMinutes,
        context as Parameters<AttendanceShiftChangeReconciler>[2],
      )
    ),
  });
  const repository = createDrizzleAttendanceRepository(database, {
    ...options,
    isFinanciallyLocked: (...input) => isFinanciallyLocked(...input),
    readRequiredDuration: (employeeId, context, includeDeleted) => (
      shifts.service.readRequiredDurationForCheckIn(employeeId, context, includeDeleted)
    ),
  });
  const payroll = createPayrollModule(database, { ...options, attendance: repository });
  isFinanciallyLocked = (employeeId, attendanceDate, context) => (
    payroll.service.isFinanciallyLocked(employeeId, attendanceDate, context)
  );
  reconcileAbsencesBeforeShiftChange = repository.reconcileDueAbsencesForEmployee;
  return { repository, payroll, processor: createAttendanceJobProcessor(repository) };
};

export * from './attendance-jobs.js';
