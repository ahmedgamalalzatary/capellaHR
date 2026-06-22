import type { Express } from "express";
import type { createAuthService } from "../modules/auth/service";
import { registerAuditLogsRoutes } from "../modules/audit-logs/routes";
import { registerAttendanceRoutes } from "../modules/attendance/routes";
import { registerAuthRoutes } from "../modules/auth/routes";
import { registerBranchesRoutes } from "../modules/branches/routes";
import { registerEmployeeDevicesRoutes } from "../modules/employee-devices/routes";
import { registerEmployeesRoutes } from "../modules/employees/routes";
import { registerMonthLocksRoutes } from "../modules/month-locks/routes";
import { registerReportsRoutes } from "../modules/reports/routes";

type RegisterAppRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
};

export function registerAppRoutes(app: Express, options: RegisterAppRoutesOptions = {}) {
  registerAuthRoutes(app, {
    authService: options.authService
  });
  registerEmployeesRoutes(app);
  registerBranchesRoutes(app);
  registerEmployeeDevicesRoutes(app);
  registerAttendanceRoutes(app);
  registerReportsRoutes(app);
  registerAuditLogsRoutes(app);
  registerMonthLocksRoutes(app);
}
