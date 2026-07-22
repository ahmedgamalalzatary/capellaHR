import type { createDatabase } from '@capella/database';
import { adminCredentials } from '@capella/database/schema';
import { hash } from 'argon2';
import { eq } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import { createDrizzleAuthRepositories } from './auth-repositories.js';
import { createAuthService, type AuthServiceDependencies } from './auth-service.js';

type Database = ReturnType<typeof createDatabase>;

const unavailableEmployees: AuthServiceDependencies['employees'] = {
  findByCode() { return Promise.resolve(null); },
};

const unavailableDevices: AuthServiceDependencies['personalDevices'] = {
  verify() { return Promise.resolve(null); },
  isActiveEmployeeDevice() { return Promise.resolve(false); },
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
      await dependencies.database.transaction(async (transaction) => {
        const before = (await transaction.select({ email: adminCredentials.email })
          .from(adminCredentials).where(eq(adminCredentials.id, 1)).for('update').limit(1))[0] ?? null;
        const updatedAt = new Date();
        const email = admin.email.toLowerCase();
        await transaction.insert(adminCredentials).values({
          id: 1,
          email,
          passwordHash,
          updatedAt,
        }).onDuplicateKeyUpdate({
          set: { email, passwordHash, updatedAt },
        });
        await writeAudit(transaction, {
          module: 'auth', action: 'credential_sync',
          entityType: 'admin_credential', entityId: 1,
          beforeState: before, afterState: { email }, createdAt: updatedAt,
        });
      });
    },
  };
};
