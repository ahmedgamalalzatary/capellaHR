import { Router } from 'express';

import { createAuthRouter, type AuthService } from '../modules/auth/index.js';
import { createBranchesRouter, type BranchService } from '../modules/branches/index.js';
import { createEmployeesRouter, type EmployeeService, type EmployeeUploadStore } from '../modules/employees/index.js';
import { createDevicesRouter, type DeviceService } from '../modules/devices/index.js';
import { createShiftsRouter, type ShiftService } from '../modules/shifts/index.js';
import { createWeeklyDayOffRouter, type WeeklyDayOffService } from '../modules/weekly-day-off/index.js';

export const createApiRouter = (dependencies: {
  authService?: AuthService;
  branchService?: BranchService;
  employeeService?: EmployeeService;
  employeeUploadStore?: EmployeeUploadStore;
  deviceService?: DeviceService;
  shiftService?: ShiftService;
  weeklyDayOffService?: WeeklyDayOffService;
  publicConfig?: { timeZone: string; locale: string };
  employeeUploadMaxBytes?: number;
  secureCookies?: boolean;
} = {}) => {
  const router = Router();

  if (dependencies.publicConfig) {
    router.get('/config', (_request, response) => {
      response.json({ data: dependencies.publicConfig });
    });
  }

  if (dependencies.authService) {
    const authOptions = dependencies.secureCookies === undefined
      ? {}
      : { secureCookies: dependencies.secureCookies };
    router.use('/auth', createAuthRouter(dependencies.authService, authOptions));
    if (dependencies.branchService) {
      router.use('/branches', createBranchesRouter(dependencies.branchService, dependencies.authService));
    }
    if (dependencies.employeeService) {
      if (dependencies.employeeUploadMaxBytes === undefined) {
        throw new Error('employeeUploadMaxBytes is required when the employee module is enabled');
      }
      router.use('/employees', createEmployeesRouter(
        dependencies.employeeService,
        dependencies.authService,
        dependencies.employeeUploadMaxBytes,
        dependencies.employeeUploadStore,
      ));
    }
    if (dependencies.deviceService) router.use('/devices', createDevicesRouter(dependencies.deviceService, dependencies.authService));
    if (dependencies.shiftService) router.use('/shifts', createShiftsRouter(dependencies.shiftService, dependencies.authService));
    if (dependencies.weeklyDayOffService) {
      router.use('/weekly-day-offs', createWeeklyDayOffRouter(
        dependencies.weeklyDayOffService,
        dependencies.authService,
      ));
    }
  }

  return router;
};
