import { type createDatabase } from '@capella/database';
import { accounts, employees } from '@capella/database/schema';
import { eq, or } from 'drizzle-orm';

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
): CashierAccountRepository => ({
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
});
