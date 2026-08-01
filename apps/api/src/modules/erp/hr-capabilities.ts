import type { ErpAccountIdentity, ErpAuthCapability } from '../auth/index.js';
import type { ErpAttendanceCapability } from '../attendance/index.js';
import type { ErpBranchCapability } from '../branches/index.js';
import type { ErpEmployeeCapability } from '../employees/index.js';
import type { ErpPayrollCapability } from '../payroll/index.js';
import type { ErpAuditCapability } from '../audit/index.js';

export type ErpHrCapabilities = {
  auth: ErpAuthCapability;
  branches: ErpBranchCapability;
  employees: ErpEmployeeCapability;
  attendance: ErpAttendanceCapability;
  audit: ErpAuditCapability;
  payroll?: ErpPayrollCapability;
};

export type {
  ErpAccountIdentity,
  ErpBranchCapability,
  ErpEmployeeCapability,
  ErpAuditCapability,
};
