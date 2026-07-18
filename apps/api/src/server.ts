import { env } from '@capella/config/server';
import { createDatabase } from '@capella/database';

import { createApp } from './app.js';
import { createAuthModule } from './modules/auth/index.js';
import { createBranchesModule } from './modules/branches/index.js';
import { createDrizzleEmployeeRepository, createEmployeesModule } from './modules/employees/index.js';
import { createDevicesModule, createWebAuthnProvider } from './modules/devices/index.js';
import { createShiftsModule } from './modules/shifts/index.js';
import { createWeeklyDayOffModule } from './modules/weekly-day-off/index.js';

const database = createDatabase(env.DATABASE_URL);
const employeeRepository = createDrizzleEmployeeRepository(database);
const webOrigin = new URL(env.WEB_ORIGIN);
const deviceModule = createDevicesModule(database, createWebAuthnProvider({ rpName: env.WEBAUTHN_RP_NAME, rpId: env.WEBAUTHN_RP_ID ?? webOrigin.hostname, origin: webOrigin.origin }));
const auth = createAuthModule({ database, employees: { findByCode: (code) => employeeRepository.findIdentityByCode(code) }, personalDevices: deviceModule.personalDevices });
await auth.initializeAdmin({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
const branchModule = createBranchesModule(database);
const employeeModule = createEmployeesModule(database, env.MAX_EMPLOYEE_IMAGE_BYTES, undefined, employeeRepository, deviceModule.lifecycle);
const shiftModule = createShiftsModule(database);
const isWeeklyDayOffFinanciallyLocked = () => Promise.resolve(false);
const weeklyDayOffModule = createWeeklyDayOffModule(database, {
  isFinanciallyLocked: isWeeklyDayOffFinanciallyLocked,
  timeZone: env.APP_TIME_ZONE,
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
  publicConfig: { timeZone: env.APP_TIME_ZONE, locale: env.APP_LOCALE },
  secureCookies: env.NODE_ENV === 'production',
  corsOrigin: env.WEB_ORIGIN,
  ...(env.TRUST_PROXY_HOPS === undefined ? {} : { trustProxyHops: env.TRUST_PROXY_HOPS }),
}).listen(env.API_PORT);
