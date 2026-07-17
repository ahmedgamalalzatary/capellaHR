import type { createDatabase } from '@capella/database';
import { adminCredentials } from '@capella/database/schema';
import { hash } from 'argon2';

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
  employees?: AuthServiceDependencies['employees'];
  personalDevices?: AuthServiceDependencies['personalDevices'];
  attendance?: AuthServiceDependencies['attendance'];
}) => {
  const repositories = createDrizzleAuthRepositories(dependencies.database);
  const service = createAuthService({
    adminCredentials: repositories.adminCredentials,
    sessions: repositories.sessions,
    attempts: repositories.attempts,
    employees: dependencies.employees ?? unavailableEmployees,
    personalDevices: dependencies.personalDevices ?? unavailableDevices,
    attendance: dependencies.attendance ?? unavailableAttendance,
  });

  return {
    service,
    repositories,
    async initializeAdmin(admin: { email: string; password: string }) {
      const passwordHash = await hash(admin.password);
      await dependencies.database.insert(adminCredentials).values({
        id: 1,
        email: admin.email.toLowerCase(),
        passwordHash,
        updatedAt: new Date(),
      }).onDuplicateKeyUpdate({
        set: {
          email: admin.email.toLowerCase(),
          passwordHash,
          updatedAt: new Date(),
        },
      });
    },
  };
};
