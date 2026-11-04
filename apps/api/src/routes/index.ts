import { Router, type RequestHandler } from 'express';

import {
  createAuthMiddleware,
  createAuthRouter,
  type AuthService,
  type CashierAccountsService,
} from '../modules/auth/index.js';
import {
  createBranchCashierRosterRouter,
  createCashierSessionsRouter,
  createErpSalesRouter,
  type BranchCashierRosterService,
  type CashierSessionService,
  type SaleService,
} from '../modules/erp/sales/index.js';
import { responseRequestId } from '../shared/http/index.js';
import { createBranchesRouter, type BranchService } from '../modules/branches/index.js';
import { createEmployeesRouter, type EmployeeService, type EmployeeUploadStore } from '../modules/employees/index.js';
import { createDevicesRouter, type DeviceService } from '../modules/devices/index.js';
import { createShiftsRouter, type ShiftService } from '../modules/shifts/index.js';
import { createWeeklyDayOffRouter, type WeeklyDayOffService } from '../modules/weekly-day-off/index.js';
import { createPayrollRouter, type PayrollService } from '../modules/payroll/index.js';
import { createBonusesRouter, type BonusService } from '../modules/bonuses/index.js';
import { createDeductionsRouter, type DeductionService } from '../modules/deductions/index.js';
import { createAdvancesRouter, type AdvanceService } from '../modules/advances/index.js';
import { createReportsRouter, renderReportExcel, type ReportService } from '../modules/reports/index.js';
import { createSelfServiceRouter, type SelfServiceService } from '../modules/self-service/index.js';
import { createAuditRouter, type AuditService } from '../modules/audit/index.js';
import { createAttendanceRouter, type AttendanceService, type FaceEnrollmentResult } from '../modules/attendance/index.js';
import { createDashboardRouter, type DashboardService } from '../modules/dashboard/index.js';
import { erpActorFromLocals, createConsumablesRouter, createErpBookingsRouter, createErpClientsRouter, createErpExpensesRouter, createErpFixedAssetsRouter, createErpProductSyncRouter, createErpProductsRouter, createErpStockTransfersRouter, createErpSuppliersRouter, type BookingService, type ClientService, type ConsumablesService, type ExpenseService, type FixedAssetService, type ProductStockService, type ProductSyncService, type StockTransferService, type SupplierPurchaseService } from '../modules/erp/index.js';
import {
  createErpCategoriesRouter,
  createErpServicesRouter,
  type CategoryService,
  type ServiceCatalogService,
} from '../modules/erp/index.js';
import {
  createErpAssignmentRouter,
  type EmployeeAssignmentService,
} from '../modules/erp/assignment/index.js';
import {
  createCommissionRouter,
  type CommissionService,
} from '../modules/erp/commissions/index.js';

/**
 * Reception works inside the branch shift the cashier opened: with no open
 * shift it is held out of every front-desk area. Other accounts pass through.
 * Without a shift service there is no way to prove a shift is open, so
 * Reception stays out.
 */
const receptionNeedsOpenShift = (shifts: CashierSessionService | undefined): RequestHandler => (
  async (_request, response, next) => {
    if ((response.locals.actor as { type?: string } | undefined)?.type !== 'reception') {
      next();
      return;
    }
    try {
      const identity = erpActorFromLocals(response.locals.actor);
      if (shifts && identity && await shifts.current(identity)) {
        next();
        return;
      }
      response.status(409).json({
        error: {
          code: 'ERP_RECEPTION_SHIFT_CLOSED',
          message: 'لا توجد وردية مفتوحة. اطلب من الكاشير فتح الوردية.',
          requestId: responseRequestId(response),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export const createApiRouter = (dependencies: {
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
  erpConsumablesService?: ConsumablesService;
  erpSupplierPurchaseService?: SupplierPurchaseService;
  erpStockTransferService?: StockTransferService;
  erpProductSyncService?: ProductSyncService;
  erpExpenseService?: ExpenseService;
  erpFixedAssetService?: FixedAssetService;
  erpAssignmentService?: EmployeeAssignmentService;
  erpCommissionService?: CommissionService;
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
    const authOptions = {
      ...(dependencies.secureCookies === undefined
        ? {}
        : { secureCookies: dependencies.secureCookies }),
      ...(dependencies.cashierAccountsService === undefined
        ? {}
        : { cashierAccounts: dependencies.cashierAccountsService }),
      ...(dependencies.employeeAuthenticationEnabled === undefined
        ? {}
        : { employeeAuthenticationEnabled: dependencies.employeeAuthenticationEnabled }),
    };
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
        dependencies.employeeFaceEnrollment,
      ));
    }
    if (dependencies.deviceService) router.use('/devices', createDevicesRouter(dependencies.deviceService, dependencies.authService));
    if (dependencies.attendanceService) {
      router.use('/attendance', createAttendanceRouter(
        dependencies.attendanceService,
        dependencies.authService,
      ));
    }
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
    if (dependencies.auditService) {
      router.use('/audit', createAuditRouter(dependencies.auditService, dependencies.authService));
    }
    if (dependencies.dashboardService) {
      router.use('/dashboard', createDashboardRouter(dependencies.dashboardService, dependencies.authService));
    }
    // ERP modules may not import the HR auth middleware, so the composition
    // root authenticates and each ERP router consumes only the resolved actor.
    // `requireErpReader` marks the front-desk areas a Reception login may look
    // at, `requireErpFrontDesk` those it may also change; every other area stays
    // behind `requireErpAccount`.
    const openShift = receptionNeedsOpenShift(dependencies.cashierSessionService);
    if (dependencies.cashierSessionService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use(
        '/erp/cashier-sessions',
        erpAuth.authenticate,
        // Reception shares the cashier's shift: it may see whether one is open,
        // never open, close, list or report on one.
        (request, response, next) => (request.method === 'GET' && request.path === '/current'
          ? erpAuth.requireErpReader
          : erpAuth.requireErpAccount)(request, response, next),
        createCashierSessionsRouter(dependencies.cashierSessionService),
      );
    }
    if (dependencies.erpBranchCashierRosterService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use(
        '/erp/branch-cashier-roster',
        erpAuth.authenticate,
        erpAuth.requireErpAccount,
        createBranchCashierRosterRouter(dependencies.erpBranchCashierRosterService),
      );
    }
    if (dependencies.erpSaleService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use(
        '/erp/sales',
        erpAuth.authenticate,
        // Reception reads invoices; the one change it may make is moving an
        // unfinished service to another employee (the repository refuses done ones).
        (request, response, next) => (request.method === 'POST'
          && /^\/invoices\/[^/]+\/queue\/[^/]+\/reassign$/.test(request.path)
          ? erpAuth.requireErpFrontDesk
          : erpAuth.requireErpReader)(request, response, next),
        openShift,
        createErpSalesRouter(dependencies.erpSaleService),
      );
    }
    if (dependencies.erpCommissionService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use(
        '/erp/commissions',
        erpAuth.authenticate,
        erpAuth.requireErpAccount,
        createCommissionRouter(dependencies.erpCommissionService, renderReportExcel),
      );
    }
    if (dependencies.erpClientService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use(
        '/erp/clients',
        erpAuth.authenticate,
        erpAuth.requireErpReader,
        openShift,
        createErpClientsRouter(dependencies.erpClientService),
      );
    }
    if (dependencies.erpBookingService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use(
        '/erp/bookings',
        erpAuth.authenticate,
        erpAuth.requireErpReader,
        openShift,
        createErpBookingsRouter(dependencies.erpBookingService),
      );
    }
    if (dependencies.erpCategoryService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use(
        '/erp/categories',
        erpAuth.authenticate,
        erpAuth.requireErpReader,
        openShift,
        createErpCategoriesRouter(dependencies.erpCategoryService),
      );
    }
    if (dependencies.erpServiceCatalogService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      // Per-employee commission rates are pay data, not catalog browsing.
      router.use(
        '/erp/services/:id/commission-overrides',
        erpAuth.authenticate,
        erpAuth.requireErpAccount,
      );
      router.use(
        '/erp/services',
        erpAuth.authenticate,
        erpAuth.requireErpReader,
        openShift,
        createErpServicesRouter(dependencies.erpServiceCatalogService),
      );
    }
    if (dependencies.erpProductStockService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use(
        '/erp/products',
        erpAuth.authenticate,
        erpAuth.requireErpReader,
        openShift,
        createErpProductsRouter(dependencies.erpProductStockService),
      );
    }
    if (dependencies.erpConsumablesService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use('/erp/consumables', erpAuth.authenticate, erpAuth.requireErpReader, openShift, createConsumablesRouter(dependencies.erpConsumablesService));
    }
    if (dependencies.erpSupplierPurchaseService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use('/erp/suppliers', erpAuth.authenticate, erpAuth.requireErpFrontDesk, openShift, createErpSuppliersRouter(dependencies.erpSupplierPurchaseService));
    }
    if (dependencies.erpStockTransferService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use(
        '/erp/stock-transfers',
        erpAuth.authenticate,
        erpAuth.requireErpAccount,
        createErpStockTransfersRouter(dependencies.erpStockTransferService),
      );
    }
    if (dependencies.erpProductSyncService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      // Deciding which branch feeds which, and settling what each product
      // matches, is the Admin's call alone.
      router.use(
        '/erp/product-sync',
        erpAuth.authenticate,
        erpAuth.requireAdmin,
        createErpProductSyncRouter(dependencies.erpProductSyncService),
      );
    }
    if (dependencies.erpExpenseService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use('/erp/expenses', erpAuth.authenticate, erpAuth.requireErpAccount, createErpExpensesRouter(dependencies.erpExpenseService));
    }
    if (dependencies.erpFixedAssetService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      // The register is the admin's own note about branch property; a cashier
      // has no business reading or changing it.
      router.use('/erp/fixed-assets', erpAuth.authenticate, erpAuth.requireAdmin, createErpFixedAssetsRouter(dependencies.erpFixedAssetService));
    }
    if (dependencies.erpAssignmentService) {
      const erpAuth = createAuthMiddleware(dependencies.authService);
      router.use(
        '/erp/assignable-employees',
        erpAuth.authenticate,
        // Reception picks the new employee when it moves a service.
        erpAuth.requireErpReader,
        openShift,
        createErpAssignmentRouter(dependencies.erpAssignmentService),
      );
    }
  }

  return router;
};
