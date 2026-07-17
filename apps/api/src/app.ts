import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import type { AuthService } from './modules/auth/index.js';
import type { BranchService } from './modules/branches/index.js';
import type { EmployeeService, EmployeeUploadStore } from './modules/employees/index.js';
import type { DeviceService } from './modules/devices/index.js';
import type { ShiftService } from './modules/shifts/index.js';
import { createApiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler, requestContext } from './shared/http/index.js';

export const createApp = (dependencies: {
  authService?: AuthService;
  branchService?: BranchService;
  employeeService?: EmployeeService;
  employeeUploadStore?: EmployeeUploadStore;
  deviceService?: DeviceService;
  shiftService?: ShiftService;
  secureCookies?: boolean;
  corsOrigin?: string;
} = {}) => {
  const app = express();

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
