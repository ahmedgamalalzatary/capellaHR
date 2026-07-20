import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import type { AuthService } from './modules/auth/index.js';
import type { BranchService } from './modules/branches/index.js';
import type { EmployeeService, EmployeeUploadStore } from './modules/employees/index.js';
import type { DeviceService } from './modules/devices/index.js';
import type { ShiftService } from './modules/shifts/index.js';
import type { WeeklyDayOffService } from './modules/weekly-day-off/index.js';
import type { PayrollService } from './modules/payroll/index.js';
import type { BonusService } from './modules/bonuses/index.js';
import type { DeductionService } from './modules/deductions/index.js';
import type { AdvanceService } from './modules/advances/index.js';
import type { ReportService } from './modules/reports/index.js';
import type { SelfServiceService } from './modules/self-service/index.js';
import { createApiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler, requestContext } from './shared/http/index.js';

export const createApp = (dependencies: {
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
  corsOrigin?: string;
  trustProxyHops?: number;
  readinessCheck?: () => Promise<void>;
} = {}) => {
  const app = express();

  if (dependencies.trustProxyHops !== undefined) app.set('trust proxy', dependencies.trustProxyHops);
  app.use(requestContext);
  app.use(helmet());
  if (dependencies.corsOrigin) {
    app.use(cors({ origin: dependencies.corsOrigin, credentials: true }));
  }
  app.use(express.json());
  app.use('/api/v1', createApiRouter(dependencies));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
