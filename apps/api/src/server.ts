import { env } from '@capella/config/server';
import { createDatabase } from '@capella/database';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { createAuthModule } from './modules/auth/index.js';
import { createBranchesModule } from './modules/branches/index.js';
import { createDrizzleEmployeeRepository, createEmployeeUploadStore, createEmployeesModule } from './modules/employees/index.js';
import { createDevicesModule } from './modules/devices/index.js';
import { createShiftsModule } from './modules/shifts/index.js';
import { createWeeklyDayOffModule } from './modules/weekly-day-off/index.js';
import { createPayrollModule, type PayrollAttendanceGateway } from './modules/payroll/index.js';
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
  advanceModule.lifecycle,
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
