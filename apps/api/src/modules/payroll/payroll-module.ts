import { type createDatabase } from '@capella/database';

import { createDrizzlePayrollRepository } from './payroll-repository.js';
import { createPayrollService, type PayrollAttendanceGateway } from './payroll-service.js';
import { createErpPayrollCapability } from './erp-payroll-capability.js';

export const createPayrollModule = (
  database: ReturnType<typeof createDatabase>,
  options: { now?: () => Date; timeZone?: string; attendance?: PayrollAttendanceGateway } = {},
) => {
  const repository = createDrizzlePayrollRepository(database, options);
  return {
    repository,
    service: createPayrollService(repository, options.attendance),
    erp: createErpPayrollCapability(database, options),
  };
};
