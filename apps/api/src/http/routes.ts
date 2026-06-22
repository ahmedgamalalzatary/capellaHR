import type { Express } from "express";
import { registerAuditLogsRoutes } from "../modules/audit-logs/routes.js";
import { registerAttendanceRoutes } from "../modules/attendance/routes.js";
import { registerAuthRoutes } from "../modules/auth/routes.js";
import { registerBranchesRoutes } from "../modules/branches/routes.js";
import { registerEmployeeDevicesRoutes } from "../modules/employee-devices/routes.js";
import { registerEmployeesRoutes } from "../modules/employees/routes.js";
import { registerMonthLocksRoutes } from "../modules/month-locks/routes.js";
import { registerReportsRoutes } from "../modules/reports/routes.js";

export function registerAppRoutes(app: Express) {
  registerAuthRoutes(app);
  registerEmployeesRoutes(app);
  registerBranchesRoutes(app);
  registerEmployeeDevicesRoutes(app);
  registerAttendanceRoutes(app);
  registerReportsRoutes(app);
  registerAuditLogsRoutes(app);
  registerMonthLocksRoutes(app);
}
