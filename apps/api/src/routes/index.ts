import { Router } from 'express';

import { createAuthRouter, type AuthService } from '../modules/auth/index.js';
import { createBranchesRouter, type BranchService } from '../modules/branches/index.js';
import { createEmployeesRouter, type EmployeeService, type EmployeeUploadStore } from '../modules/employees/index.js';
import { createDevicesRouter, type DeviceService } from '../modules/devices/index.js';
import { createShiftsRouter, type ShiftService } from '../modules/shifts/index.js';
import { createWeeklyDayOffRouter, type WeeklyDayOffService } from '../modules/weekly-day-off/index.js';
import { createPayrollRouter, type PayrollService } from '../modules/payroll/index.js';
import { createBonusesRouter, type BonusService } from '../modules/bonuses/index.js';
import { createDeductionsRouter, type DeductionService } from '../modules/deductions/index.js';
import { createAdvancesRouter, type AdvanceService } from '../modules/advances/index.js';
import { createReportsRouter, type ReportService } from '../modules/reports/index.js';
import { createSelfServiceRouter, type SelfServiceService } from '../modules/self-service/index.js';

export const createApiRouter = (dependencies: {
  authService?: AuthService;
  branchService?: BranchService;
  employeeService?: EmployeeService;
  employeeUploadStore?: EmployeeUploadStore;
  deviceService?: DeviceService;
  shiftService?: ShiftService;
  weeklyDayOffService?: WeeklyDayOffService;
  payrollService?: PayrollService;
  bonusService?: BonusService;
  deductionService?: DeductionService;
  advanceService?: AdvanceService;
  reportService?: ReportService;
  selfServiceService?: SelfServiceService;
  publicConfig?: { timeZone: string; locale: string };
  employeeUploadMaxBytes?: number;
  secureCookies?: boolean;
  readinessCheck?: () => Promise<void>;
} = {}) => {
  const router = Router();

  router.get('/health/live', (_request, response) => {
    response.json({ status: 'ok' });
  });

  if (dependencies.readinessCheck) {
    router.get('/health/ready', async (_request, response) => {
      try {
        await dependencies.readinessCheck?.();
        response.json({ status: 'ok' });
      } catch {
        response.status(503).json({ status: 'unavailable' });
      }
    });
  }

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
    if (dependencies.payrollService) router.use('/payroll', createPayrollRouter(dependencies.payrollService, dependencies.authService));
    if (dependencies.bonusService) router.use('/bonuses', createBonusesRouter(dependencies.bonusService, dependencies.authService));
    if (dependencies.deductionService) router.use('/deductions', createDeductionsRouter(dependencies.deductionService, dependencies.authService));
    if (dependencies.advanceService) router.use('/advances', createAdvancesRouter(dependencies.advanceService, dependencies.authService));
    if (dependencies.reportService) router.use('/reports', createReportsRouter(dependencies.reportService, dependencies.authService));
    if (dependencies.selfServiceService) {
      router.use('/self-service', createSelfServiceRouter(dependencies.selfServiceService, dependencies.authService));
    }
  }

  return router;
};
