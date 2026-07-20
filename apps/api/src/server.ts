import { env } from '@capella/config/server';
import { createDatabase } from '@capella/database';
import { sql } from 'drizzle-orm';

import { createApp } from './app.js';
import { createAuthModule } from './modules/auth/index.js';
import { createBranchesModule } from './modules/branches/index.js';
import { createDrizzleEmployeeRepository, createEmployeesModule } from './modules/employees/index.js';
import { createDevicesModule, createWebAuthnProvider } from './modules/devices/index.js';
import { createShiftsModule } from './modules/shifts/index.js';
import { createWeeklyDayOffModule } from './modules/weekly-day-off/index.js';
import { createPayrollModule } from './modules/payroll/index.js';
import { createBonusModule } from './modules/bonuses/index.js';
import { createDeductionModule } from './modules/deductions/index.js';
import { createAdvanceModule } from './modules/advances/index.js';
import { createReportsModule } from './modules/reports/index.js';
import { createSelfServiceModule } from './modules/self-service/index.js';
import { createAuditModule } from './modules/audit/index.js';

const database = createDatabase(env.DATABASE_URL);
const employeeRepository = createDrizzleEmployeeRepository(database);
const webOrigin = new URL(env.WEB_ORIGIN);
const deviceModule = createDevicesModule(database, createWebAuthnProvider({ rpName: env.WEBAUTHN_RP_NAME, rpId: env.WEBAUTHN_RP_ID ?? webOrigin.hostname, origin: webOrigin.origin }));
const auth = createAuthModule({ database, employees: { findByCode: (code) => employeeRepository.findIdentityByCode(code) }, personalDevices: deviceModule.personalDevices });
await auth.initializeAdmin({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
const branchModule = createBranchesModule(database);
const shiftModule = createShiftsModule(database);
const payrollModule = createPayrollModule(database, { timeZone: env.APP_TIME_ZONE });
const bonusModule = createBonusModule(database, { timeZone: env.APP_TIME_ZONE });
const deductionModule = createDeductionModule(database, { timeZone: env.APP_TIME_ZONE });
const advanceModule = createAdvanceModule(database, { timeZone: env.APP_TIME_ZONE });
const reportsModule = createReportsModule(database, {
  ...(env.REPORT_FILES_ROOT === undefined ? {} : { filesRoot: env.REPORT_FILES_ROOT }),
  timeZone: env.APP_TIME_ZONE,
});
const auditModule = createAuditModule(database, { timeZone: env.APP_TIME_ZONE });
const employeeModule = createEmployeesModule(
  database,
  env.MAX_EMPLOYEE_IMAGE_BYTES,
  undefined,
  employeeRepository,
  deviceModule.lifecycle,
  advanceModule.lifecycle,
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
  publicConfig: { timeZone: env.APP_TIME_ZONE, locale: env.APP_LOCALE },
  secureCookies: env.NODE_ENV === 'production',
  corsOrigin: env.WEB_ORIGIN,
  ...(env.TRUST_PROXY_HOPS === undefined ? {} : { trustProxyHops: env.TRUST_PROXY_HOPS }),
  readinessCheck: async () => {
    await database.execute(sql`SELECT 1`);
  },
}).listen(env.API_PORT);
