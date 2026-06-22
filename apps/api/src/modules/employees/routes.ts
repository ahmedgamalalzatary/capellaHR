import type { Express } from "express";
import { requireEmployeeSession } from "../attendance/attendance-route-helpers";
import { requireAdminSession } from "../auth/admin-session";
import { type RegisterEmployeesRoutesOptions, createEmployeeUpload } from "./employee-route-helpers";
import { registerEmployeeCrudRoutes } from "./employee-crud.routes";
import { registerEmployeeFileRoutes } from "./employee-file.routes";
import { registerEmployeeSelfRoutes } from "./employee-self.routes";

export function registerEmployeesRoutes(app: Express, options: RegisterEmployeesRoutesOptions = {}) {
  const adminSessionMiddleware = requireAdminSession({
    authService: options.authService
  });
  const employeeSessionMiddleware = requireEmployeeSession({
    authService: options.authService
  });
  const upload = createEmployeeUpload();
  const uploadCreateFields = upload.fields([
    { name: "personalPhoto", maxCount: 1 },
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 }
  ]);

  registerEmployeeSelfRoutes(app, options, employeeSessionMiddleware);
  registerEmployeeCrudRoutes(app, options, adminSessionMiddleware, uploadCreateFields);
  registerEmployeeFileRoutes(app, options, adminSessionMiddleware, upload.single("file"));
}
