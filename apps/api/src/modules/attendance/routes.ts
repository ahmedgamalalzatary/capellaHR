import type { Express } from "express";
import { requireAdminSession } from "../auth/admin-session";
import { type RegisterAttendanceRoutesOptions, requireEmployeeSession } from "./attendance-route-helpers";
import { registerAdminAttendanceRoutes } from "./admin-attendance.routes";
import { registerEmployeeAttendanceRoutes } from "./employee-attendance.routes";

export function registerAttendanceRoutes(
  app: Express,
  options: RegisterAttendanceRoutesOptions = {}
) {
  const employeeSessionMiddleware = requireEmployeeSession({
    authService: options.authService
  });
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });

  registerEmployeeAttendanceRoutes(app, options, employeeSessionMiddleware);
  registerAdminAttendanceRoutes(app, options, adminSessionMiddleware);
}
