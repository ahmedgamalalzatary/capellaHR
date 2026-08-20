import { hasModule, type ResolvedEdition } from '@capella/config/edition';
import type { createDatabase } from '@capella/database';
import type { Logger } from 'pino';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AppDependencies } from '../app.js';
import { createAdvanceModule } from '../modules/advances/index.js';
import { createAttendanceModule, createOnnxFaceGateway, type AttendanceShiftChangeReconciler } from '../modules/attendance/index.js';
import { createAuditModule } from '../modules/audit/index.js';
import { createAuthModule } from '../modules/auth/index.js';
import { createBonusModule } from '../modules/bonuses/index.js';
import { createBranchesModule } from '../modules/branches/index.js';
import { createDashboardModule } from '../modules/dashboard/index.js';
import { createDeductionModule } from '../modules/deductions/index.js';
import { createDevicesModule } from '../modules/devices/index.js';
import {
  createDrizzleEmployeeRepository,
  createEmployeeFinancialLifecycle,
  createEmployeeUploadStore,
  createEmployeesModule,
} from '../modules/employees/index.js';
import {
  createCommissionModule,
  createErpAssignmentModule,
  createErpCatalogModule,
  createErpClientsModule,
  createErpExpensesModule,
  createErpReportsModule,
  createErpStockModule,
  createErpSuppliersModule,
} from '../modules/erp/index.js';
import { createSalesModule } from '../modules/erp/sales/index.js';
import { createErpTransfersModule } from '../modules/erp/transfers/index.js';
import { createPayrollModule } from '../modules/payroll/index.js';
import { createReportsModule } from '../modules/reports/index.js';
import { createSelfServiceModule } from '../modules/self-service/index.js';
import { createShiftsModule } from '../modules/shifts/index.js';
import { createWeeklyDayOffModule } from '../modules/weekly-day-off/index.js';

type Database = ReturnType<typeof createDatabase>;

export interface ApiRuntimeOptions {
  database: Database;
  edition: ResolvedEdition;
  logger: Logger;
  timeZone: string;
  maxEmployeeImageBytes: number;
  reportFilesRoot?: string;
  employeeUploadsRoot?: string;
}

const required = <T>(value: T | undefined, name: string): T => {
  if (value === undefined) throw new Error(`Enabled module dependency "${name}" was not constructed.`);
  return value;
};

export const createApiRuntime = (options: ApiRuntimeOptions) => {
  const { database, edition, logger, timeZone } = options;
  const enabled = (name: Parameters<typeof hasModule>[1]) => hasModule(edition, name);

  const branchModule = createBranchesModule(database);
  const auditModule = createAuditModule(database, { timeZone });
  let reconcileAbsencesBeforeShiftChange: AttendanceShiftChangeReconciler = () => Promise.resolve(0);
  const employeeRepository = createDrizzleEmployeeRepository(
    database,
    () => new Date(),
    (...input) => reconcileAbsencesBeforeShiftChange(...input),
  );
  const employeeUploadStore = createEmployeeUploadStore(
    options.employeeUploadsRoot
      ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/employees'),
    options.maxEmployeeImageBytes,
  );

  const deviceModule = enabled('devices') ? createDevicesModule(database) : undefined;
  const shiftModule = enabled('shifts') ? createShiftsModule(database, {
    beforeDurationChange: (employeeId, previousDurationMinutes, context) => (
      reconcileAbsencesBeforeShiftChange(
        employeeId,
        previousDurationMinutes,
        context as Parameters<AttendanceShiftChangeReconciler>[2],
      )
    ),
  }) : undefined;

  let applyPendingDeactivation: (
    employeeId: number,
    at: Date,
    context: unknown,
  ) => Promise<void> = () => Promise.resolve();
  const payrollForAttendance: { current?: ReturnType<typeof createPayrollModule>['service'] } = {};
  const attendanceModule = enabled('attendance') ? (() => {
    const attendanceDevices = required(deviceModule, 'devices').attendanceDevices;
    const shifts = required(shiftModule, 'shifts').service;
    return createAttendanceModule(
      database,
      attendanceDevices,
      createOnnxFaceGateway((storagePath) => employeeUploadStore.read(storagePath)),
      {
        isFinanciallyLocked: (employeeId, attendanceDate, context) => (
          payrollForAttendance.current?.isFinanciallyLocked(employeeId, attendanceDate, context)
          ?? Promise.resolve(false)
        ),
        readRequiredDuration: (employeeId, context, includeDeleted) => (
          shifts.readRequiredDurationForCheckIn(
            employeeId,
            context,
            includeDeleted,
          )
        ),
        afterSessionClosed: (employeeId, at, context) => (
          applyPendingDeactivation(employeeId, at, context)
        ),
        timeZone,
      },
    );
  })() : undefined;
  if (attendanceModule) {
    reconcileAbsencesBeforeShiftChange = attendanceModule.repository.reconcileDueAbsencesForEmployee;
  }

  const payrollModule = enabled('payroll') ? createPayrollModule(database, {
    timeZone,
    attendance: required(attendanceModule, 'attendance').repository,
  }) : undefined;
  if (payrollModule) payrollForAttendance.current = payrollModule.service;

  const bonusModule = enabled('bonuses') ? createBonusModule(database, { timeZone }) : undefined;
  const deductionModule = enabled('deductions') ? createDeductionModule(database, { timeZone }) : undefined;
  const advanceModule = enabled('advances') ? createAdvanceModule(database, { timeZone }) : undefined;

  const employeeFinancialLifecycle = payrollModule ? (() => {
    const attendance = required(attendanceModule, 'attendance').repository;
    const advances = required(advanceModule, 'advances');
    return createEmployeeFinancialLifecycle({
      timeZone,
      now: () => new Date(),
      attendance,
      advances: {
        prepareEmployeeDeletion: advances.lifecycle.prepareEmployeeDeletion,
        deactivationImpact: (employeeId, at, context) => (
          advances.service.deactivationImpact(employeeId, at, context)
        ),
        accelerateForDeletion: (employeeId, at, context) => (
          advances.service.accelerateForDeletion(employeeId, at, context)
        ),
      },
      settlements: {
        recordAdjustment: (employeeId, at, reason, amount, context) => (
          advances.service.recordDeactivationAdjustment(employeeId, at, reason, amount, context)
        ),
        recordOutstandingDebt: (employeeId, at, amount, context) => (
          advances.service.recordOutstandingDebt(employeeId, at, amount, context)
        ),
      },
      payroll: {
        preview: (employeeId, month) => payrollModule.service.preview(employeeId, month),
        previewInContext: (employeeId, month, lifecycleAttendance, context) => (
          payrollModule.repository.previewInContext(
            employeeId,
            month,
            lifecycleAttendance,
            context,
          )
        ),
        isFinalized: (employeeId, attendanceDate, context) => (
          payrollModule.repository.isFinalized(employeeId, attendanceDate, context)
        ),
      },
    });
  })() : undefined;

  const employeeModule = createEmployeesModule(
    database,
    options.maxEmployeeImageBytes,
    attendanceModule?.service,
    employeeRepository,
    deviceModule?.lifecycle,
    employeeFinancialLifecycle,
    employeeUploadStore,
    // Left unwired deliberately: nothing can hold open work against an employee until the
    // bookings and service-queue modules exist. Wire them here when they land.
    undefined,
  );
  applyPendingDeactivation = async (employeeId, at, context) => {
    await employeeModule.service.applyPendingDeactivation(employeeId, at, context);
  };

  const authModule = createAuthModule({
    database,
    cashierAccountsEnabled: enabled('erp-sales'),
    employees: { findByCode: (code) => employeeRepository.findIdentityByCode(code) },
    ...(deviceModule ? { personalDevices: deviceModule.personalDevices } : {}),
    ...(attendanceModule ? { attendance: attendanceModule.service } : {}),
    onLoginLimitCleanupError: (error) => {
      logger.warn({ err: error }, 'Cashier login-limit retention cleanup failed');
    },
  });

  const weeklyDayOffModule = enabled('weekly-day-offs') ? (() => {
    const payroll = required(payrollModule, 'payroll').service;
    return createWeeklyDayOffModule(database, {
      isFinanciallyLocked: (employeeId, attendanceDate, context) => (
        payroll.isFinanciallyLocked(
          employeeId,
          attendanceDate,
          context,
        )
      ),
      timeZone,
    });
  })() : undefined;

  const erpAssignmentModule = enabled('erp-assignment') ? createErpAssignmentModule({
    attendance: required(attendanceModule, 'attendance').erp,
    branches: branchModule.erp,
    employees: employeeModule.erp,
  }) : undefined;
  const erpClientsModule = enabled('erp-clients') ? createErpClientsModule(database, {
    audit: auditModule.erp,
    branches: branchModule.erp,
    employees: employeeModule.erp,
  }) : undefined;
  const erpCatalogModule = enabled('erp-catalog') ? createErpCatalogModule(database, {
    audit: auditModule.erp,
    branches: branchModule.erp,
    employees: employeeModule.erp,
  }) : undefined;
  const erpStockModule = enabled('erp-stock') ? createErpStockModule(database, {
    audit: auditModule.erp,
    branches: branchModule.erp,
    employees: employeeModule.erp,
  }) : undefined;
  const erpSuppliersModule = enabled('erp-suppliers') ? createErpSuppliersModule(database, {
    audit: auditModule.erp,
    branches: branchModule.erp,
    employees: employeeModule.erp,
  }) : undefined;
  const erpExpensesModule = enabled('erp-expenses') ? createErpExpensesModule(database, {
    audit: auditModule.erp,
    branches: branchModule.erp,
    employees: employeeModule.erp,
  }) : undefined;
  const salesModule = enabled('erp-sales') ? createSalesModule(database, {
    audit: auditModule.erp,
    branches: branchModule.erp,
    employees: employeeModule.erp,
    assignment: required(erpAssignmentModule, 'erp-assignment').service,
    ...(payrollModule ? { payroll: payrollModule.erp } : {}),
  }) : undefined;
  const erpTransfersModule = enabled('erp-transfers') && salesModule
    ? createErpTransfersModule(database, {
        audit: auditModule.erp,
        branches: branchModule.erp,
        sales: salesModule.sales,
      })
    : undefined;
  const commissionModule = enabled('erp-commissions') ? createCommissionModule(database, {
    branches: branchModule.erp,
    employees: employeeModule.erp,
  }) : undefined;
  const erpReportsModule = enabled('erp-reports') ? createErpReportsModule(database) : undefined;
  const payrollReportDependencies = payrollModule ? {
    payroll: payrollModule.repository,
    attendance: required(attendanceModule, 'attendance').repository,
  } : undefined;

  const reportsModule = enabled('reports') ? createReportsModule(database, {
    ...(options.reportFilesRoot === undefined ? {} : { filesRoot: options.reportFilesRoot }),
    timeZone,
    ...(payrollReportDependencies ? {
      payroll: {
        preview: (employeeId, month, context) => payrollReportDependencies.payroll.previewInContext(
          employeeId,
          month,
          payrollReportDependencies.attendance,
          context,
        ),
      },
    } : {}),
    ...(erpReportsModule ? { erp: erpReportsModule.reader } : {}),
  }) : undefined;

  const selfServiceModule = enabled('self-service') ? createSelfServiceModule({
    employees: employeeModule.service,
    branches: branchModule.service,
    attendance: required(attendanceModule, 'attendance').service,
    weeklyDays: required(weeklyDayOffModule, 'weekly-day-offs').service,
    payroll: required(payrollModule, 'payroll').service,
    bonuses: required(bonusModule, 'bonuses').service,
    deductions: required(deductionModule, 'deductions').service,
    advances: required(advanceModule, 'advances').service,
    ...(commissionModule ? { commissions: commissionModule.selfService } : {}),
  }) : undefined;
  const dashboardModule = enabled('dashboard')
    ? createDashboardModule(database, { timeZone })
    : undefined;

  const dependencies: AppDependencies = {
    authService: authModule.service,
    branchService: branchModule.service,
    employeeService: employeeModule.service,
    employeeUploadStore: employeeModule.uploadStore,
    employeeUploadMaxBytes: options.maxEmployeeImageBytes,
    employeeAuthenticationEnabled: enabled('self-service'),
    auditService: auditModule.service,
    ...(enabled('erp-sales') ? {
      cashierAccountsService: required(authModule.cashierAccounts, 'erp-sales'),
    } : {}),
    ...(deviceModule ? { deviceService: deviceModule.service } : {}),
    ...(shiftModule ? { shiftService: shiftModule.service } : {}),
    ...(attendanceModule ? { attendanceService: attendanceModule.service } : {}),
    ...(weeklyDayOffModule ? { weeklyDayOffService: weeklyDayOffModule.service } : {}),
    ...(payrollModule ? { payrollService: payrollModule.service } : {}),
    ...(bonusModule ? { bonusService: bonusModule.service } : {}),
    ...(deductionModule ? { deductionService: deductionModule.service } : {}),
    ...(advanceModule ? { advanceService: advanceModule.service } : {}),
    ...(reportsModule ? { reportService: reportsModule.service } : {}),
    ...(selfServiceModule ? { selfServiceService: selfServiceModule.service } : {}),
    ...(dashboardModule ? { dashboardService: dashboardModule.service } : {}),
    ...(salesModule ? {
      cashierSessionService: salesModule.cashierSessions,
      erpBranchCashierRosterService: salesModule.branchCashierRoster,
      erpSaleService: salesModule.sales,
    } : {}),
    ...(erpClientsModule ? { erpClientService: erpClientsModule.service } : {}),
    ...(erpCatalogModule ? {
      erpCategoryService: erpCatalogModule.categories,
      erpServiceCatalogService: erpCatalogModule.services,
    } : {}),
    ...(erpStockModule ? { erpProductStockService: erpStockModule.service } : {}),
    ...(erpSuppliersModule ? { erpSupplierPurchaseService: erpSuppliersModule.service } : {}),
    ...(erpTransfersModule ? { erpStockTransferService: erpTransfersModule.service } : {}),
    ...(erpExpensesModule ? { erpExpenseService: erpExpensesModule.service } : {}),
    ...(erpAssignmentModule ? { erpAssignmentService: erpAssignmentModule.service } : {}),
    ...(commissionModule ? { erpCommissionService: commissionModule.service } : {}),
  };

  return {
    dependencies,
    edition,
    async initialize(admin: { email: string; password: string }) {
      await authModule.initializeAdmin(admin);
      await employeeModule.uploadStore.retryPendingCleanup();
    },
  };
};
