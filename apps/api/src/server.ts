import { env } from '@capella/config/server';
import { createDatabase } from '@capella/database';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { createAuthModule } from './modules/auth/index.js';
import { createBranchesModule } from './modules/branches/index.js';
import { createDrizzleEmployeeRepository, createEmployeeUploadStore, createEmployeesModule, EmployeeError, projectDeactivationBalance } from './modules/employees/index.js';
import { createDevicesModule } from './modules/devices/index.js';
import { createShiftsModule } from './modules/shifts/index.js';
import { createWeeklyDayOffModule } from './modules/weekly-day-off/index.js';
import { calendarMonthInTimeZone, createPayrollModule, type PayrollAttendanceGateway } from './modules/payroll/index.js';
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
import { createApiLogger } from './shared/http/index.js';

const database = createDatabase(env.DATABASE_URL);
const logger = createApiLogger(env.LOG_LEVEL);
let reconcileAbsencesBeforeShiftChange: AttendanceShiftChangeReconciler = () => Promise.resolve(0);
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
const attendanceForPayroll: { current?: PayrollAttendanceGateway } = {};
const payrollModule = createPayrollModule(database, {
  timeZone: env.APP_TIME_ZONE,
  attendance: {
    readPayrollFacts: (...input) => {
      if (!attendanceForPayroll.current) throw new Error('Attendance payroll gateway is not initialized');
      return attendanceForPayroll.current.readPayrollFacts(...input);
    },
  },
});
const attendanceModule = createAttendanceModule(
  database,
  deviceModule.attendanceDevices,
  faceGateway,
  {
    isFinanciallyLocked: (employeeId, attendanceDate, context) => (
      payrollModule.service.isFinanciallyLocked(employeeId, attendanceDate, context)
    ),
    readRequiredDuration: (employeeId, context, includeDeleted) => (
      shiftModule.service.readRequiredDurationForCheckIn(employeeId, context, includeDeleted)
    ),
    timeZone: env.APP_TIME_ZONE,
  },
);
attendanceForPayroll.current = attendanceModule.repository;
reconcileAbsencesBeforeShiftChange = attendanceModule.repository.reconcileDueAbsencesForEmployee;
const auth = createAuthModule({
  database,
  employees: { findByCode: (code) => employeeRepository.findIdentityByCode(code) },
  personalDevices: deviceModule.personalDevices,
  attendance: attendanceModule.service,
});
await auth.initializeAdmin({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
const bonusModule = createBonusModule(database, { timeZone: env.APP_TIME_ZONE });
const deductionModule = createDeductionModule(database, { timeZone: env.APP_TIME_ZONE });
const advanceModule = createAdvanceModule(database, { timeZone: env.APP_TIME_ZONE });
const employeeFinancialLifecycle = {
  prepareEmployeeDeletion: advanceModule.lifecycle.prepareEmployeeDeletion,
  async previewEmployeeDeactivation(employeeId: number) {
    const at = new Date();
    const month = calendarMonthInTimeZone(at, env.APP_TIME_ZONE);
    const [impact, payroll] = await Promise.all([
      advanceModule.service.deactivationImpact(employeeId, at),
      payrollModule.service.preview(employeeId, month),
    ]);
    return {
      unpaidInstallmentCount: impact.unpaidInstallmentCount,
      unpaidAdvanceAmount: impact.unpaidAdvanceAmount,
      ...projectDeactivationBalance(
        payroll.netSalary,
        impact.unpaidAdvanceAmount,
        impact.currentMonthAdvanceAmount,
      ),
    };
  },
  async prepareEmployeeDeactivation(
    employeeId: number,
    at: Date,
    input: import('@capella/contracts').EmployeeDeactivationInput,
    context: unknown,
  ) {
    const month = calendarMonthInTimeZone(at, env.APP_TIME_ZONE);
    if (await payrollModule.repository.isFinalized(employeeId, `${month}-01`, context)) {
      throw new EmployeeError('EMPLOYEE_PAYROLL_FINALIZED', 'لا يمكن تعطيل الموظف بعد اعتماد راتب الشهر الحالي');
    }
    const impact = await advanceModule.service.deactivationImpact(employeeId, at, context);
    if (
      impact.unpaidInstallmentCount !== input.expectedUnpaidInstallmentCount
      || impact.unpaidAdvanceAmount !== input.expectedUnpaidAdvanceAmount
    ) {
      throw new EmployeeError('EMPLOYEE_DEACTIVATION_PREVIEW_CHANGED', 'تغيرت بيانات المعاينة. راجع القيم وأكد مرة أخرى');
    }
    await advanceModule.service.accelerateForDeletion(employeeId, at, context);
    const result = await payrollModule.repository.previewInContext(
      employeeId,
      month,
      attendanceModule.repository,
      context,
    );
    if (result.kind !== 'success') {
      throw new Error(`Deactivation payroll preview failed: ${result.kind}`);
    }
    const amountOwed = result.payroll.netSalary.startsWith('-')
      ? result.payroll.netSalary.slice(1)
      : '0.00';
    if (
      result.payroll.netSalary !== input.expectedProjectedNetSalary
      || amountOwed !== input.expectedAmountOwed
    ) {
      throw new EmployeeError('EMPLOYEE_DEACTIVATION_PREVIEW_CHANGED', 'تغيرت بيانات المعاينة. راجع القيم وأكد مرة أخرى');
    }
    if (input.negativeBalanceDecision === 'paid' && result.payroll.netSalary.startsWith('-')) {
      await advanceModule.service.settleDeactivationPayment(
        employeeId,
        at,
        result.payroll.netSalary.slice(1),
        context,
      );
      const paidResult = await payrollModule.repository.previewInContext(
        employeeId,
        month,
        attendanceModule.repository,
        context,
      );
      if (paidResult.kind !== 'success' || paidResult.payroll.netSalary !== '0.00') {
        throw new Error('Deactivation payment did not settle payroll to zero');
      }
    }
  },
};
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

createApp({
  authService: auth.service,
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
