import { createErpBranchContextResolver } from '../branch-context.js';
import type {
  ErpAttendanceCapability,
  ErpBranchCapability,
  ErpEmployeeCapability,
} from '../hr-capabilities.js';
import { createEmployeeAssignmentService } from './assignment-service.js';

/**
 * Composition root for assignment eligibility. It owns no tables: presence is
 * read from HR through the public Attendance capability alone, so no ERP
 * schema, migration, or cached copy of attendance state exists.
 */
export const createErpAssignmentModule = (capabilities: {
  attendance: ErpAttendanceCapability;
  branches: ErpBranchCapability;
  employees: ErpEmployeeCapability;
}) => ({
  service: createEmployeeAssignmentService({
    attendance: capabilities.attendance,
    resolveBranchContext: createErpBranchContextResolver(capabilities),
  }),
});
