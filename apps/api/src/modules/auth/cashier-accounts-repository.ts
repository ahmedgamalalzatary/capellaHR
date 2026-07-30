import { type createDatabase } from '@capella/database';
import { accounts, authSessions, employees } from '@capella/database/schema';
import { and, count, eq, isNull, or } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import type { CashierAccountRepository } from './cashier-accounts-service.js';

type Database = ReturnType<typeof createDatabase>;

const errorCode = (error: unknown): string | undefined => {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};

export const createDrizzleCashierAccountRepository = (
  database: Database,
): CashierAccountRepository => {
  const selectPublic = async (
    executor: Parameters<Parameters<Database['transaction']>[0]>[0] | Database,
    accountId: number,
  ) => {
    const row = (await executor.select({
      id: accounts.id,
      username: accounts.username,
      role: accounts.role,
      employeeId: accounts.employeeId,
      branchId: employees.branchId,
      active: accounts.active,
    }).from(accounts).innerJoin(employees, eq(employees.id, accounts.employeeId)).where(and(
      eq(accounts.id, accountId),
      eq(accounts.role, 'cashier'),
    )).limit(1))[0];
    return row?.role === 'cashier' && row.employeeId !== null
      ? { ...row, role: 'cashier' as const, employeeId: row.employeeId }
      : null;
  };

  return {
  promoteEmployeeToCashier(input) {
    return database.transaction(async (tx) => {
      const employee = (await tx.select({
        id: employees.id,
        branchId: employees.branchId,
        employmentStatus: employees.employmentStatus,
        deletedAt: employees.deletedAt,
      }).from(employees).where(eq(employees.id, input.employeeId)).for('update').limit(1))[0];
      if (!employee || employee.deletedAt) return { kind: 'employee_not_found' as const };
      if (employee.employmentStatus !== 'active') return { kind: 'employee_inactive' as const };

      const existing = (await tx.select({
        username: accounts.username,
        employeeId: accounts.employeeId,
      }).from(accounts).where(or(
        eq(accounts.username, input.username),
        eq(accounts.employeeId, input.employeeId),
      )).limit(1))[0];
      if (existing?.employeeId === input.employeeId) {
        return { kind: 'employee_already_has_account' as const };
      }
      if (existing) return { kind: 'username_taken' as const };

      let id: number;
      try {
        const inserted = await tx.insert(accounts).values(input);
        id = Number(inserted[0].insertId);
      } catch (error) {
        if (errorCode(error) !== 'ER_DUP_ENTRY') throw error;
        const conflict = (await tx.select({
          username: accounts.username,
          employeeId: accounts.employeeId,
        }).from(accounts).where(or(
          eq(accounts.username, input.username),
          eq(accounts.employeeId, input.employeeId),
        )).limit(1))[0];
        return conflict?.employeeId === input.employeeId
          ? { kind: 'employee_already_has_account' as const }
          : { kind: 'username_taken' as const };
      }

      const account = {
        id,
        username: input.username,
        role: 'cashier' as const,
        employeeId: input.employeeId,
        branchId: employee.branchId,
        active: true,
      };
      await writeAudit(tx, {
        module: 'auth',
        action: 'cashier_promote',
        entityType: 'account',
        entityId: id,
        afterState: account,
        relatedIds: {
          accountId: id,
          employeeId: input.employeeId,
          branchId: employee.branchId,
        },
        createdAt: input.createdAt,
      });
      return { kind: 'created' as const, account };
    });
  },
    async listCashiers(query) {
      const where = eq(accounts.role, 'cashier');
      const [items, totals] = await Promise.all([
        database.select({
          id: accounts.id, username: accounts.username, role: accounts.role,
          employeeId: accounts.employeeId, branchId: employees.branchId, active: accounts.active,
        }).from(accounts).innerJoin(employees, eq(employees.id, accounts.employeeId))
          .where(where).orderBy(accounts.id)
          .limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        database.select({ total: count() }).from(accounts).where(where),
      ]);
      return {
        items: items.flatMap((row) => row.role === 'cashier' && row.employeeId !== null
          ? [{ ...row, role: 'cashier' as const, employeeId: row.employeeId }]
          : []),
        total: totals[0]?.total ?? 0,
      };
    },
    setCashierActive(input) {
      return database.transaction(async (tx) => {
        const before = await selectPublic(tx, input.accountId);
        if (!before) return { kind: 'not_found' as const };
        if (input.active) {
          const employee = (await tx.select({
            employmentStatus: employees.employmentStatus,
            deletedAt: employees.deletedAt,
          }).from(employees).where(eq(employees.id, before.employeeId))
            .for('update').limit(1))[0];
          if (!employee || employee.deletedAt || employee.employmentStatus !== 'active') {
            return { kind: 'employee_inactive' as const };
          }
        }
        await tx.update(accounts).set({ active: input.active, updatedAt: input.updatedAt })
          .where(eq(accounts.id, input.accountId));
        if (!input.active) {
          await tx.update(authSessions).set({ revokedAt: input.updatedAt }).where(and(
            eq(authSessions.accountId, input.accountId),
            isNull(authSessions.revokedAt),
          ));
        }
        const account = { ...before, active: input.active };
        await writeAudit(tx, {
          module: 'auth', action: input.active ? 'cashier_enable' : 'cashier_disable',
          entityType: 'account', entityId: input.accountId,
          beforeState: before, afterState: account,
          relatedIds: { accountId: input.accountId, employeeId: before.employeeId },
          createdAt: input.updatedAt,
        });
        return { kind: 'updated' as const, account };
      });
    },
    updateCashierPassword(input) {
      return database.transaction(async (tx) => {
        const account = await selectPublic(tx, input.accountId);
        if (!account) return { kind: 'not_found' as const };
        await tx.update(accounts).set({
          passwordHash: input.passwordHash,
          updatedAt: input.updatedAt,
        }).where(eq(accounts.id, input.accountId));
        await tx.update(authSessions).set({ revokedAt: input.updatedAt }).where(and(
          eq(authSessions.accountId, input.accountId),
          isNull(authSessions.revokedAt),
        ));
        await writeAudit(tx, {
          module: 'auth', action: 'cashier_password_reset',
          entityType: 'account', entityId: input.accountId,
          beforeState: { credentialsChanged: false },
          afterState: { credentialsChanged: true },
          relatedIds: { accountId: input.accountId, employeeId: account.employeeId },
          createdAt: input.updatedAt,
        });
        return { kind: 'updated' as const, account };
      });
    },
  };
};
