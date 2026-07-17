import type { createDatabase } from '@capella/database';

import { createDrizzleAuthRepositories } from './auth-repositories.js';
import {
  createAuthService,
  type AuthServiceDependencies,
} from './auth-service.js';

type Database = ReturnType<typeof createDatabase>;

const unavailableEmployees: AuthServiceDependencies['employees'] = {
  findByCode() { return Promise.resolve(null); },
};

const unavailableDevices: AuthServiceDependencies['personalDevices'] = {
  verify() { return Promise.resolve(false); },
};

const unavailableAttendance: AuthServiceDependencies['attendance'] = {
  hasOpenSession() { return Promise.resolve(false); },
};

export const createAuthModule = (dependencies: {
  database: Database;
  admin: AuthServiceDependencies['admin'];
  employees?: AuthServiceDependencies['employees'];
  personalDevices?: AuthServiceDependencies['personalDevices'];
  attendance?: AuthServiceDependencies['attendance'];
}) => {
  const repositories = createDrizzleAuthRepositories(dependencies.database);
  const service = createAuthService({
    admin: dependencies.admin,
    sessions: repositories.sessions,
    attempts: repositories.attempts,
    employees: dependencies.employees ?? unavailableEmployees,
    personalDevices: dependencies.personalDevices ?? unavailableDevices,
    attendance: dependencies.attendance ?? unavailableAttendance,
  });

  return { service, repositories };
};
