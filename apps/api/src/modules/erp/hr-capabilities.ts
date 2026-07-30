import type { ErpAccountIdentity, ErpAuthCapability } from '../auth/index.js';
import type { ErpAttendanceCapability } from '../attendance/index.js';
import type { ErpBranchCapability } from '../branches/index.js';
import type { ErpEmployeeCapability } from '../employees/index.js';
import type { ErpPayrollCapability } from '../payroll/index.js';

export type ErpHrCapabilities = {
  auth: ErpAuthCapability;
  branches: ErpBranchCapability;
  employees: ErpEmployeeCapability;
  attendance: ErpAttendanceCapability;
  payroll?: ErpPayrollCapability;
};

export type {
  ErpAccountIdentity,
  ErpBranchCapability,
  ErpEmployeeCapability,
};
