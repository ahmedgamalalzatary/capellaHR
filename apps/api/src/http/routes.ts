import type { Express } from "express";
import type { createAttendanceService } from "../modules/attendance/service";
import type { createAuditLogService } from "../modules/audit-logs/service";
import type { createAuthService } from "../modules/auth/service";
import type { createBranchService } from "../modules/branches/service";
import type { createEmployeeDeviceService } from "../modules/employee-devices/service";
import type { createEmployeeService } from "../modules/employees/service";
import type { createPermissionAbsenceService } from "../modules/permission-absences/service";
import type { createMonthLockService } from "../modules/month-locks/service";
import type { createReportsService } from "../modules/reports/service";
import type { createWeeklyDayOffService } from "../modules/weekly-day-offs/service";
import { registerAuditLogsRoutes } from "../modules/audit-logs/routes";
import { registerAttendanceRoutes } from "../modules/attendance/routes";
import { registerAuthRoutes } from "../modules/auth/routes";
import { registerBranchesRoutes } from "../modules/branches/routes";
import { registerEmployeeDevicesRoutes } from "../modules/employee-devices/routes";
import { registerEmployeesRoutes } from "../modules/employees/routes";
import { registerMonthLocksRoutes } from "../modules/month-locks/routes";
import { registerPermissionAbsenceRoutes } from "../modules/permission-absences/routes";
import { registerReportsRoutes } from "../modules/reports/routes";
import { registerWeeklyDayOffRoutes } from "../modules/weekly-day-offs/routes";

type RegisterAppRoutesOptions = {
  attendanceService?: ReturnType<typeof createAttendanceService>;
  auditLogService?: ReturnType<typeof createAuditLogService>;
  authService?: ReturnType<typeof createAuthService>;
  branchService?: ReturnType<typeof createBranchService>;
  employeeDeviceService?: ReturnType<typeof createEmployeeDeviceService>;
  employeeService?: ReturnType<typeof createEmployeeService>;
  permissionAbsenceService?: ReturnType<typeof createPermissionAbsenceService>;
  monthLockService?: ReturnType<typeof createMonthLockService>;
  reportsService?: ReturnType<typeof createReportsService>;
  weeklyDayOffService?: ReturnType<typeof createWeeklyDayOffService>;
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
  registerAttendanceRoutes(app, {
    authService: options.authService,
    attendanceService: options.attendanceService
  });
  registerWeeklyDayOffRoutes(app, {
    authService: options.authService,
    weeklyDayOffService: options.weeklyDayOffService
  });
  registerPermissionAbsenceRoutes(app, {
    authService: options.authService,
    permissionAbsenceService: options.permissionAbsenceService
  });
  registerReportsRoutes(app, {
    authService: options.authService,
    reportsService: options.reportsService
  });
  registerAuditLogsRoutes(app, {
    authService: options.authService,
    auditLogService: options.auditLogService
  });
  registerMonthLocksRoutes(app, {
    authService: options.authService,
    monthLockService: options.monthLockService
  });
}
