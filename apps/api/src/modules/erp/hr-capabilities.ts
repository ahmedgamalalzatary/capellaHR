import type { ErpAccountIdentity, ErpAuthCapability } from '../auth/index.js';
import type { ErpAttendanceCapability } from '../attendance/index.js';
import type { ErpAuditCapability, ErpAuditEvent, ErpAuditExecutor } from '../audit/index.js';
import type { ErpBranchCapability } from '../branches/index.js';
import type { ErpEmployeeCapability } from '../employees/index.js';
import type { ErpPayrollCapability } from '../payroll/index.js';
import type { ReportReader } from '../reports/index.js';

export type ErpHrCapabilities = {
  auth: ErpAuthCapability;
  audit: ErpAuditCapability;
  branches: ErpBranchCapability;
  employees: ErpEmployeeCapability;
  attendance: ErpAttendanceCapability;
  payroll?: ErpPayrollCapability;
};

export type {
  ErpAccountIdentity,
  ErpAttendanceCapability,
  ErpAuditCapability,
  ErpAuditEvent,
  ErpAuditExecutor,
  ErpBranchCapability,
  ErpEmployeeCapability,
  ErpPayrollCapability,
  ReportReader,
};
