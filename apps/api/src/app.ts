import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Logger } from 'pino';

import type { AuthService, CashierAccountsService } from './modules/auth/index.js';
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
import type { AuditService } from './modules/audit/index.js';
import type { AttendanceService, FaceEnrollmentResult } from './modules/attendance/index.js';
import type { DashboardService } from './modules/dashboard/index.js';
import type {
  BranchCashierRosterService,
  CashierSessionService,
  SaleService,
} from './modules/erp/sales/index.js';
import type { BookingService, ClientService, ExpenseService, FixedAssetService, ProductStockService, StockTransferService, SupplierPurchaseService } from './modules/erp/index.js';
import type { CategoryService, ServiceCatalogService } from './modules/erp/index.js';
import type { EmployeeAssignmentService } from './modules/erp/assignment/index.js';
import type { CommissionService } from './modules/erp/commissions/index.js';
import { createApiRouter } from './routes/index.js';
import {
  createRequestLogger,
  createOriginGuard,
  errorHandler,
  notFoundHandler,
  requestContext,
} from './shared/http/index.js';

export interface AppDependencies {
  authService?: AuthService;
  cashierAccountsService?: CashierAccountsService;
  employeeAuthenticationEnabled?: boolean;
  branchService?: BranchService;
  employeeService?: EmployeeService;
  employeeUploadStore?: EmployeeUploadStore;
  employeeFaceEnrollment?: (employeeId: string, photo: Buffer) => Promise<FaceEnrollmentResult>;
  deviceService?: DeviceService;
  shiftService?: ShiftService;
  weeklyDayOffService?: WeeklyDayOffService;
  payrollService?: PayrollService;
  bonusService?: BonusService;
  deductionService?: DeductionService;
  advanceService?: AdvanceService;
  reportService?: ReportService;
  selfServiceService?: SelfServiceService;
  auditService?: AuditService;
  attendanceService?: AttendanceService;
  dashboardService?: DashboardService;
  cashierSessionService?: CashierSessionService;
  erpBranchCashierRosterService?: BranchCashierRosterService;
  erpSaleService?: SaleService;
  erpClientService?: ClientService;
  erpBookingService?: BookingService;
  erpCategoryService?: CategoryService;
  erpServiceCatalogService?: ServiceCatalogService;
  erpProductStockService?: ProductStockService;
  erpSupplierPurchaseService?: SupplierPurchaseService;
  erpStockTransferService?: StockTransferService;
  erpExpenseService?: ExpenseService;
  erpFixedAssetService?: FixedAssetService;
  erpAssignmentService?: EmployeeAssignmentService;
  erpCommissionService?: CommissionService;
  publicConfig?: { timeZone: string; locale: string };
  employeeUploadMaxBytes?: number;
  secureCookies?: boolean;
  corsOrigins?: string[];
  publicOrigins?: string[];
  enforceSameOrigin?: boolean;
  allowHostOriginFallback?: boolean;
  trustProxyHops?: number;
  readinessCheck?: () => Promise<void>;
  logger?: Logger;
}

export const createApp = (dependencies: AppDependencies = {}) => {
  const app = express();

  app.set('etag', false);
  if (dependencies.trustProxyHops !== undefined) app.set('trust proxy', dependencies.trustProxyHops);
  app.use(requestContext);
  app.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  if (dependencies.logger) app.use(createRequestLogger(dependencies.logger));
  app.use(helmet());
  if (dependencies.enforceSameOrigin) {
    app.use(createOriginGuard({
      ...(dependencies.publicOrigins === undefined
        ? {} : { selfOrigins: dependencies.publicOrigins }),
      ...(dependencies.corsOrigins === undefined
        ? {} : { allowedOrigins: dependencies.corsOrigins }),
      ...(dependencies.allowHostOriginFallback === undefined
        ? {} : { allowHostFallback: dependencies.allowHostOriginFallback }),
    }));
  }
  if (dependencies.corsOrigins?.length) {
    app.use(cors({ origin: dependencies.corsOrigins, credentials: true }));
  }
  app.use(express.json());
  app.use('/api/v1', createApiRouter(dependencies));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
