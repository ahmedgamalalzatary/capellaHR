import { env } from '@capella/config/server';
import { createDatabase } from '@capella/database';

import { createApp } from './app.js';
import { createAuthModule } from './modules/auth/index.js';
import { createBranchesModule } from './modules/branches/index.js';
import { createDrizzleEmployeeRepository, createEmployeesModule } from './modules/employees/index.js';
import { createDevicesModule, createWebAuthnProvider } from './modules/devices/index.js';

const database = createDatabase(env.DATABASE_URL);
const employeeRepository = createDrizzleEmployeeRepository(database);
const webOrigin = new URL(env.WEB_ORIGIN);
const deviceModule = createDevicesModule(database, createWebAuthnProvider({ rpName: env.WEBAUTHN_RP_NAME, rpId: env.WEBAUTHN_RP_ID ?? webOrigin.hostname, origin: webOrigin.origin }));
const auth = createAuthModule({ database, employees: { findByCode: (code) => employeeRepository.findIdentityByCode(code) }, personalDevices: deviceModule.personalDevices });
await auth.initializeAdmin({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
const branchModule = createBranchesModule(database);
const employeeModule = createEmployeesModule(database, undefined, employeeRepository, deviceModule.lifecycle);
await employeeModule.uploadStore.retryPendingCleanup();

createApp({
  authService: auth.service,
  branchService: branchModule.service,
  employeeService: employeeModule.service,
  employeeUploadStore: employeeModule.uploadStore,
  deviceService: deviceModule.service,
  secureCookies: env.NODE_ENV === 'production',
  corsOrigin: env.WEB_ORIGIN,
}).listen(env.API_PORT);
