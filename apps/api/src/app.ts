import express from "express";
import type { createAuthService } from "./modules/auth/service";
import type { createBranchService } from "./modules/branches/service";
import type { createEmployeeService } from "./modules/employees/service";
import { registerNotFoundHandler } from "./http/not-found-handler";
import { registerHealthRoutes } from "./http/health-routes";
import { registerAppMiddleware } from "./http/middleware/index";
import { registerAppRoutes } from "./http/routes";

type CreateAppOptions = {
  authService?: ReturnType<typeof createAuthService>;
  branchService?: ReturnType<typeof createBranchService>;
  employeeService?: ReturnType<typeof createEmployeeService>;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  registerAppMiddleware(app);
  registerHealthRoutes(app);
  registerAppRoutes(app, {
    authService: options.authService,
    branchService: options.branchService,
    employeeService: options.employeeService
  });
  registerNotFoundHandler(app);

  return app;
}
