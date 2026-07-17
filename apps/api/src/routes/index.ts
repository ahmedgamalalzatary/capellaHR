import { Router } from 'express';

import { createAuthRouter, type AuthService } from '../modules/auth/index.js';
import { createBranchesRouter, type BranchService } from '../modules/branches/index.js';
import { createEmployeesRouter, type EmployeeService, type EmployeeUploadStore } from '../modules/employees/index.js';
import { createDevicesRouter, type DeviceService } from '../modules/devices/index.js';

export const createApiRouter = (dependencies: {
  authService?: AuthService;
  branchService?: BranchService;
  employeeService?: EmployeeService;
  employeeUploadStore?: EmployeeUploadStore;
  deviceService?: DeviceService;
  secureCookies?: boolean;
} = {}) => {
  const router = Router();

  if (dependencies.authService) {
    const authOptions = dependencies.secureCookies === undefined
      ? {}
      : { secureCookies: dependencies.secureCookies };
    router.use('/auth', createAuthRouter(dependencies.authService, authOptions));
    if (dependencies.branchService) {
      router.use('/branches', createBranchesRouter(dependencies.branchService, dependencies.authService));
    }
    if (dependencies.employeeService) router.use('/employees', createEmployeesRouter(dependencies.employeeService, dependencies.authService, dependencies.employeeUploadStore));
    if (dependencies.deviceService) router.use('/devices', createDevicesRouter(dependencies.deviceService, dependencies.authService));
  }

  return router;
};
