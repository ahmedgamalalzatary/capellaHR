import express from "express";
import type { createAuthService } from "./modules/auth/service";
import type { createAttendanceService } from "./modules/attendance/service";
import type { createBranchService } from "./modules/branches/service";
import type { createEmployeeDeviceService } from "./modules/employee-devices/service";
import type { createEmployeeService } from "./modules/employees/service";
import type { createPermissionAbsenceService } from "./modules/permission-absences/service";
import type { createWeeklyDayOffService } from "./modules/weekly-day-offs/service";
import { registerNotFoundHandler } from "./http/not-found-handler";
import { registerHealthRoutes } from "./http/health-routes";
import { registerAppMiddleware } from "./http/middleware/index";
import { registerAppRoutes } from "./http/routes";

type CreateAppOptions = {
  authService?: ReturnType<typeof createAuthService>;
  attendanceService?: ReturnType<typeof createAttendanceService>;
  branchService?: ReturnType<typeof createBranchService>;
  employeeDeviceService?: ReturnType<typeof createEmployeeDeviceService>;
  employeeService?: ReturnType<typeof createEmployeeService>;
  permissionAbsenceService?: ReturnType<typeof createPermissionAbsenceService>;
  weeklyDayOffService?: ReturnType<typeof createWeeklyDayOffService>;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  registerAppMiddleware(app);
  registerHealthRoutes(app);
  registerAppRoutes(app, {
    authService: options.authService,
    attendanceService: options.attendanceService,
    branchService: options.branchService,
    employeeDeviceService: options.employeeDeviceService,
    employeeService: options.employeeService,
    permissionAbsenceService: options.permissionAbsenceService,
    weeklyDayOffService: options.weeklyDayOffService
  });
  registerNotFoundHandler(app);

  return app;
}
