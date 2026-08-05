import { env } from '@capella/config/server';
import { createDatabase } from '@capella/database';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { createAuthModule } from './modules/auth/index.js';
import { createBranchesModule } from './modules/branches/index.js';
import { createDrizzleEmployeeRepository, createEmployeeFinancialLifecycle, createEmployeeUploadStore, createEmployeesModule } from './modules/employees/index.js';
import { createDevicesModule } from './modules/devices/index.js';
import { createShiftsModule } from './modules/shifts/index.js';
import { createWeeklyDayOffModule } from './modules/weekly-day-off/index.js';
import { createPayrollModule } from './modules/payroll/index.js';
import { createBonusModule } from './modules/bonuses/index.js';
import { createDeductionModule } from './modules/deductions/index.js';
import { createAdvanceModule } from './modules/advances/index.js';
import { createReportsModule } from './modules/reports/index.js';
import { createSelfServiceModule } from './modules/self-service/index.js';
import { createAuditModule } from './modules/audit/index.js';
import {
  createAttendanceModule,
  createOnnxFaceGateway,
  type AttendanceShiftChangeReconciler,
} from './modules/attendance/index.js';
import { createDashboardModule } from './modules/dashboard/index.js';
import { createSalesModule } from './modules/erp/sales/index.js';
import {
  createErpAssignmentModule,
  createErpCatalogModule,
  createErpStockModule,
  createErpClientsModule,
  createErpSuppliersModule,
  createErpExpensesModule,
} from './modules/erp/index.js';
import { createApiLogger } from './shared/http/index.js';

const database = createDatabase(env.DATABASE_URL);
const logger = createApiLogger(env.LOG_LEVEL);
let reconcileAbsencesBeforeShiftChange: AttendanceShiftChangeReconciler = () => Promise.resolve(0);
// Assigned once the employee module exists; attendance is constructed first because the
// employee financial lifecycle needs the attendance gateway to price the deactivation.
let applyPendingDeactivation: (
  employeeId: number, at: Date, context: unknown,
) => Promise<void> = () => Promise.resolve();
const employeeRepository = createDrizzleEmployeeRepository(
  database,
  () => new Date(),
  (...input) => reconcileAbsencesBeforeShiftChange(...input),
);
const deviceModule = createDevicesModule(database);
const employeeUploadStore = createEmployeeUploadStore(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../uploads/employees'),
  env.MAX_EMPLOYEE_IMAGE_BYTES,
);
const faceGateway = createOnnxFaceGateway((storagePath) => employeeUploadStore.read(storagePath));
const branchModule = createBranchesModule(database);
const shiftModule = createShiftsModule(database, {
  beforeDurationChange: (employeeId, previousDurationMinutes, context) => (
    reconcileAbsencesBeforeShiftChange(
      employeeId,
      previousDurationMinutes,
      context as Parameters<AttendanceShiftChangeReconciler>[2],
    )
  ),
});
const payrollForAttendance: {
  current?: ReturnType<typeof createPayrollModule>['service'];
} = {};
const attendanceModule = createAttendanceModule(
  database,
  deviceModule.attendanceDevices,
  faceGateway,
  {
    isFinanciallyLocked: (employeeId, attendanceDate, context) => (
      payrollForAttendance.current?.isFinanciallyLocked(employeeId, attendanceDate, context)
      ?? Promise.resolve(false)
    ),
    readRequiredDuration: (employeeId, context, includeDeleted) => (
      shiftModule.service.readRequiredDurationForCheckIn(employeeId, context, includeDeleted)
    ),
    // A deactivation requested while the employee was checked in runs here, in the same
    // transaction as the check-out that finally allows it.
    afterSessionClosed: (employeeId, at, context) => (
      applyPendingDeactivation(employeeId, at, context)
    ),
    timeZone: env.APP_TIME_ZONE,
  },
);
const payrollModule = createPayrollModule(database, {
  timeZone: env.APP_TIME_ZONE,
  attendance: attendanceModule.repository,
});
payrollForAttendance.current = payrollModule.service;
reconcileAbsencesBeforeShiftChange = attendanceModule.repository.reconcileDueAbsencesForEmployee;
const auth = createAuthModule({
  database,
  employees: { findByCode: (code) => employeeRepository.findIdentityByCode(code) },
  personalDevices: deviceModule.personalDevices,
  attendance: attendanceModule.service,
  onLoginLimitCleanupError: (error) => {
    logger.warn({ err: error }, 'Cashier login-limit retention cleanup failed');
  },
});
await auth.initializeAdmin({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
const bonusModule = createBonusModule(database, { timeZone: env.APP_TIME_ZONE });
const deductionModule = createDeductionModule(database, { timeZone: env.APP_TIME_ZONE });
const advanceModule = createAdvanceModule(database, { timeZone: env.APP_TIME_ZONE });
const employeeFinancialLifecycle = createEmployeeFinancialLifecycle({
  timeZone: env.APP_TIME_ZONE,
  now: () => new Date(),
  attendance: attendanceModule.repository,
  advances: {
    prepareEmployeeDeletion: advanceModule.lifecycle.prepareEmployeeDeletion,
    deactivationImpact: (employeeId, at, context) => (
      advanceModule.service.deactivationImpact(employeeId, at, context)
    ),
    accelerateForDeletion: (employeeId, at, context) => (
      advanceModule.service.accelerateForDeletion(employeeId, at, context)
    ),
  },
  settlements: {
    recordAdjustment: (employeeId, at, reason, amount, context) => (
      advanceModule.service.recordDeactivationAdjustment(employeeId, at, reason, amount, context)
    ),
    recordOutstandingDebt: (employeeId, at, amount, context) => (
      advanceModule.service.recordOutstandingDebt(employeeId, at, amount, context)
    ),
  },
  payroll: {
    preview: (employeeId, month) => payrollModule.service.preview(employeeId, month),
    previewInContext: (employeeId, month, attendance, context) => (
      payrollModule.repository.previewInContext(employeeId, month, attendance, context)
    ),
    isFinalized: (employeeId, attendanceDate, context) => (
      payrollModule.repository.isFinalized(employeeId, attendanceDate, context)
    ),
  },
});
const reportsModule = createReportsModule(database, {
  ...(env.REPORT_FILES_ROOT === undefined ? {} : { filesRoot: env.REPORT_FILES_ROOT }),
  timeZone: env.APP_TIME_ZONE,
  payroll: {
    preview: (employeeId, month, context) => (
      payrollModule.repository.previewInContext(
        employeeId,
        month,
        attendanceModule.repository,
        context,
      )
    ),
  },
});
const auditModule = createAuditModule(database, { timeZone: env.APP_TIME_ZONE });
const dashboardModule = createDashboardModule(database, {
  timeZone: env.APP_TIME_ZONE,
});
const employeeModule = createEmployeesModule(
  database,
  env.MAX_EMPLOYEE_IMAGE_BYTES,
  attendanceModule.service,
  employeeRepository,
  deviceModule.lifecycle,
  employeeFinancialLifecycle,
  employeeUploadStore,
);
applyPendingDeactivation = async (employeeId, at, context) => {
  await employeeModule.service.applyPendingDeactivation(employeeId, at, context);
};
const weeklyDayOffModule = createWeeklyDayOffModule(database, {
  isFinanciallyLocked: (employeeId, attendanceDate, context) => (
    payrollModule.service.isFinanciallyLocked(employeeId, attendanceDate, context)
  ),
  timeZone: env.APP_TIME_ZONE,
});
const selfServiceModule = createSelfServiceModule({
  employees: employeeModule.service,
  branches: branchModule.service,
  attendance: attendanceModule.service,
  weeklyDays: weeklyDayOffModule.service,
  payroll: payrollModule.service,
  bonuses: bonusModule.service,
  deductions: deductionModule.service,
  advances: advanceModule.service,
});
await employeeModule.uploadStore.retryPendingCleanup();

// ERP composition: ERP modules reach HR only through these public capabilities,
// and resolve the acting branch from the account rather than from the request.
const erpClientsModule = createErpClientsModule(database, {
  audit: auditModule.erp,
  branches: branchModule.erp,
  employees: employeeModule.erp,
});
const erpCatalogModule = createErpCatalogModule(database, {
  audit: auditModule.erp,
  branches: branchModule.erp,
  employees: employeeModule.erp,
});
// Assignment eligibility is read from live Attendance only; it owns no tables.
const erpAssignmentModule = createErpAssignmentModule({
  attendance: attendanceModule.erp,
  branches: branchModule.erp,
  employees: employeeModule.erp,
});
const erpStockModule = createErpStockModule(database, {
  audit: auditModule.erp,
  branches: branchModule.erp,
  employees: employeeModule.erp,
});
const erpSuppliersModule = createErpSuppliersModule(database, {
  audit: auditModule.erp,
  branches: branchModule.erp,
  employees: employeeModule.erp,
});
const erpExpensesModule = createErpExpensesModule(database, {
  audit: auditModule.erp,
  branches: branchModule.erp,
  employees: employeeModule.erp,
});
const salesModule = createSalesModule(database, {
  audit: auditModule.erp,
  branches: branchModule.erp,
  employees: employeeModule.erp,
  assignment: erpAssignmentModule.service,
});

createApp({
  authService: auth.service,
  cashierAccountsService: auth.cashierAccounts,
  branchService: branchModule.service,
  employeeService: employeeModule.service,
  employeeUploadStore: employeeModule.uploadStore,
  employeeUploadMaxBytes: env.MAX_EMPLOYEE_IMAGE_BYTES,
  deviceService: deviceModule.service,
  shiftService: shiftModule.service,
  weeklyDayOffService: weeklyDayOffModule.service,
  payrollService: payrollModule.service,
  bonusService: bonusModule.service,
  deductionService: deductionModule.service,
  advanceService: advanceModule.service,
  reportService: reportsModule.service,
  selfServiceService: selfServiceModule.service,
  auditService: auditModule.service,
  attendanceService: attendanceModule.service,
  dashboardService: dashboardModule.service,
  cashierSessionService: salesModule.cashierSessions,
  erpSaleService: salesModule.sales,
  erpClientService: erpClientsModule.service,
  erpCategoryService: erpCatalogModule.categories,
  erpServiceCatalogService: erpCatalogModule.services,
  erpProductStockService: erpStockModule.service,
  erpSupplierPurchaseService: erpSuppliersModule.service,
  erpExpenseService: erpExpensesModule.service,
  erpAssignmentService: erpAssignmentModule.service,
  publicConfig: { timeZone: env.APP_TIME_ZONE, locale: env.APP_LOCALE },
  secureCookies: env.NODE_ENV === 'production',
  corsOrigin: env.WEB_ORIGIN,
  ...(env.TRUST_PROXY_HOPS === undefined ? {} : { trustProxyHops: env.TRUST_PROXY_HOPS }),
  readinessCheck: async () => {
    await database.execute(sql`SELECT 1`);
  },
  logger,
}).listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, 'API server started');
});
