import type { Express } from "express";
import type { createAuthService } from "../modules/auth/service";
import type { createBranchService } from "../modules/branches/service";
import type { createEmployeeDeviceService } from "../modules/employee-devices/service";
import type { createEmployeeService } from "../modules/employees/service";
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
  branchService?: ReturnType<typeof createBranchService>;
  employeeDeviceService?: ReturnType<typeof createEmployeeDeviceService>;
  employeeService?: ReturnType<typeof createEmployeeService>;
};

export function registerAppRoutes(app: Express, options: RegisterAppRoutesOptions = {}) {
  registerAuthRoutes(app, {
    authService: options.authService
  });
  registerEmployeesRoutes(app, {
    authService: options.authService,
    employeeService: options.employeeService
  });
  registerBranchesRoutes(app, {
    authService: options.authService,
    branchService: options.branchService
  });
  registerEmployeeDevicesRoutes(app, {
    authService: options.authService,
    employeeDeviceService: options.employeeDeviceService
  });
  registerAttendanceRoutes(app);
  registerReportsRoutes(app);
  registerAuditLogsRoutes(app);
  registerMonthLocksRoutes(app);
}
