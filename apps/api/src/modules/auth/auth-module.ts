import type { createDatabase } from '@capella/database';
import { accounts, authSessions } from '@capella/database/schema';
import { hash, verify } from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import { createDrizzleAuthRepositories } from './auth-repositories.js';
import { createAuthService, type AuthServiceDependencies } from './auth-service.js';
import { createDrizzleCashierAccountRepository } from './cashier-accounts-repository.js';
import { createCashierAccountsService } from './cashier-accounts-service.js';
import { createErpAuthCapability } from './erp-auth-capability.js';

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
  onLoginLimitCleanupError?: (error: unknown) => void;
}) => {
  const repositories = createDrizzleAuthRepositories(
    dependencies.database,
    undefined,
    dependencies.onLoginLimitCleanupError
      ? { onLoginLimitCleanupError: dependencies.onLoginLimitCleanupError }
      : {},
  );
  const cashierAccountRepository = createDrizzleCashierAccountRepository(dependencies.database);
  const cashierAccounts = createCashierAccountsService({
    accounts: cashierAccountRepository,
    hashPassword: hash,
  });
  const service = createAuthService({
    accounts: repositories.accountCredentials,
    sessions: repositories.sessions,
    attempts: repositories.attempts,
    employees: dependencies.employees ?? unavailableEmployees,
    personalDevices: dependencies.personalDevices ?? unavailableDevices,
    attendance: dependencies.attendance ?? unavailableAttendance,
  });

  return {
    service,
    erp: createErpAuthCapability(service),
    cashierAccounts,
    repositories,
    async initializeAdmin(admin: { email: string; password: string }) {
      await dependencies.database.transaction(async (transaction) => {
        const before = (await transaction.select({
          id: accounts.id,
          username: accounts.username,
          passwordHash: accounts.passwordHash,
        }).from(accounts).where(eq(accounts.role, 'admin')).for('update').limit(1))[0] ?? null;
        const updatedAt = new Date();
        const username = admin.email.trim().toLowerCase();
        if (before && before.username === username && await verify(before.passwordHash, admin.password)) {
          return;
        }
        const passwordHash = await hash(admin.password);
        let accountId: number;
        if (before) {
          accountId = before.id;
          await transaction.update(accounts).set({ username, passwordHash, updatedAt })
            .where(eq(accounts.id, before.id));
          await transaction.update(authSessions).set({ revokedAt: updatedAt }).where(and(
            eq(authSessions.accountId, before.id),
            isNull(authSessions.revokedAt),
          ));
        } else {
          const inserted = await transaction.insert(accounts).values({
            username, passwordHash, role: 'admin', employeeId: null,
            active: true, createdAt: updatedAt, updatedAt,
          });
          accountId = Number(inserted[0].insertId);
        }
        await writeAudit(transaction, {
          module: 'auth', action: 'credential_sync',
          entityType: 'account', entityId: accountId,
          beforeState: before ? { username: before.username } : null,
          afterState: { username, role: 'admin' },
          relatedIds: { accountId },
          createdAt: updatedAt,
        });
      });
    },
  };
};
